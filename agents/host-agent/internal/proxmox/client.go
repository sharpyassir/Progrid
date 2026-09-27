// Package proxmox is a minimal client for the Proxmox VE REST API covering what the
// agent needs: clone from template, configure, power, resize, snapshot, firewall.
package proxmox

import (
	"context"
	"crypto/tls"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/pgcloud/host-agent/internal/config"
)

type Client struct {
	cfg  config.Proxmox
	http *http.Client
	log  *slog.Logger
}

func New(cfg config.Proxmox, log *slog.Logger) *Client {
	tr := &http.Transport{TLSClientConfig: &tls.Config{InsecureSkipVerify: cfg.Insecure}} //nolint:gosec // local PVE self-signed cert
	return &Client{cfg: cfg, http: &http.Client{Transport: tr, Timeout: 60 * time.Second}, log: log}
}

func (c *Client) Node() string { return c.cfg.Node }

// APIError is a non-2xx response. Most are permanent (bad config), so not retryable.
type APIError struct {
	Status int
	Body   string
}

func (e *APIError) Error() string { return fmt.Sprintf("proxmox %d: %s", e.Status, e.Body) }

// Retryable reports whether the control plane should retry the job.
func (e *APIError) Retryable() bool { return e.Status >= 500 || e.Status == 429 }

func (c *Client) do(ctx context.Context, method, path string, form url.Values, out interface{}) error {
	var body io.Reader
	if form != nil {
		body = strings.NewReader(form.Encode())
	}
	req, err := http.NewRequestWithContext(ctx, method, c.cfg.URL+"/api2/json"+path, body)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "PVEAPIToken="+c.cfg.TokenID+"="+c.cfg.TokenSecret)
	if form != nil {
		req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	}
	res, err := c.http.Do(req)
	if err != nil {
		return fmt.Errorf("proxmox %s %s: %w", method, path, err)
	}
	defer res.Body.Close()
	b, _ := io.ReadAll(res.Body)
	if res.StatusCode/100 != 2 {
		return &APIError{Status: res.StatusCode, Body: strings.TrimSpace(string(b))}
	}
	if out == nil {
		return nil
	}
	var env struct {
		Data json.RawMessage `json:"data"`
	}
	if err := json.Unmarshal(b, &env); err != nil {
		return fmt.Errorf("decode: %w", err)
	}
	return json.Unmarshal(env.Data, out)
}

func (c *Client) nodePath(p string) string { return "/nodes/" + c.cfg.Node + p }
func (c *Client) vmPath(vmid int, p string) string {
	return c.nodePath(fmt.Sprintf("/qemu/%d%s", vmid, p))
}

// ---- tasks ----

// waitTask polls a UPID until it finishes. Proxmox returns UPIDs for all long ops.
func (c *Client) waitTask(ctx context.Context, upid string, timeout time.Duration) error {
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		var st struct {
			Status     string `json:"status"`
			ExitStatus string `json:"exitstatus"`
		}
		if err := c.do(ctx, http.MethodGet, c.nodePath("/tasks/"+url.PathEscape(upid)+"/status"), nil, &st); err != nil {
			return err
		}
		if st.Status == "stopped" {
			if st.ExitStatus != "OK" {
				return fmt.Errorf("task %s failed: %s", upid, st.ExitStatus)
			}
			return nil
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(2 * time.Second):
		}
	}
	return fmt.Errorf("task %s timed out after %s", upid, timeout)
}

func (c *Client) post(ctx context.Context, path string, form url.Values, wait time.Duration) error {
	var upid string
	if err := c.do(ctx, http.MethodPost, path, form, &upid); err != nil {
		return err
	}
	if upid == "" || wait == 0 {
		return nil
	}
	return c.waitTask(ctx, upid, wait)
}

// ---- VM lifecycle ----

func (c *Client) NextID(ctx context.Context) (int, error) {
	var s string
	if err := c.do(ctx, http.MethodGet, "/cluster/nextid", nil, &s); err != nil {
		return 0, err
	}
	var id int
	_, err := fmt.Sscanf(s, "%d", &id)
	return id, err
}

// Clone does a full clone of a template onto the Ceph storage.
func (c *Client) Clone(ctx context.Context, template, newid int, name string) error {
	return c.CloneSnapshot(ctx, template, "", newid, name)
}

// CloneSnapshot does a full clone of a VM's snapshot (qm clone --snapname). An empty
// snapname clones the current state, which is what template clones use.
func (c *Client) CloneSnapshot(ctx context.Context, source int, snapname string, newid int, name string) error {
	f := url.Values{"newid": {fmt.Sprint(newid)}, "name": {name}, "full": {"1"}, "storage": {c.cfg.Storage}}
	if snapname != "" {
		f.Set("snapname", snapname)
	}
	return c.post(ctx, c.vmPath(source, "/clone"), f, 10*time.Minute)
}

// Configure sets CPU/RAM, cloud-init and network. Snippets for user-data live on a
// shared "snippets" storage so cloud-init can pick them up.
type VMConfig struct {
	Cores     int
	MemoryMb  int
	SSHKeys   []string
	UserData  string // path on snippets storage, e.g. "local:snippets/<vmid>-user.yaml"
	Hostname  string
	PublicIP  string // "203.0.113.5/24"
	Gateway   string
	PrivateIP string // "10.96.3.7/24" (static, no gateway), or "dhcp" when the control plane sent none
	Bridge    string
	// BridgeMTU makes net0 take the bridge MTU (mtu=1), which the guest then learns from virtio.
	// Set for SDN VNets, where VXLAN leaves 1450 bytes.
	BridgeMTU bool
	PublicBr  string
	Tags      string
}

func (c *Client) Configure(ctx context.Context, vmid int, v VMConfig) error {
	net0 := "virtio,bridge=" + v.Bridge + ",firewall=1"
	if v.BridgeMTU {
		net0 += ",mtu=1"
	}
	f := url.Values{
		"cores":     {fmt.Sprint(v.Cores)},
		"memory":    {fmt.Sprint(v.MemoryMb)},
		"agent":     {"enabled=1"},
		"onboot":    {"1"},
		"name":      {v.Hostname},
		"tags":      {v.Tags},
		"ciuser":    {"root"},
		"net0":      {net0},
		"ipconfig0": {"ip=" + v.PrivateIP},
	}
	if v.PublicIP != "" {
		f.Set("net1", "virtio,bridge="+v.PublicBr+",firewall=1")
		f.Set("ipconfig1", "ip="+v.PublicIP+",gw="+v.Gateway)
	}
	if len(v.SSHKeys) > 0 {
		f.Set("sshkeys", EncodeSSHKeys(v.SSHKeys))
	}
	if v.UserData != "" {
		f.Set("cicustom", "user="+v.UserData)
	}
	return c.do(ctx, http.MethodPost, c.vmPath(vmid, "/config"), f, nil)
}

// EncodeSSHKeys renders the sshkeys config value. Proxmox expects the keys URL encoded
// with %20 for spaces and %0A for newlines, and decodes it without turning "+" into a
// space. url.QueryEscape writes spaces as "+" (and a literal "+" as %2B), so every "+" left
// in its output was a space. The form encoding of the request wraps the value once more.
func EncodeSSHKeys(keys []string) string {
	return strings.ReplaceAll(url.QueryEscape(strings.Join(keys, "\n")), "+", "%20")
}

// SetResources changes only cores and memory. Name, tags and network stay untouched so
// a resize never rewrites the MAC address or the attribution tags.
func (c *Client) SetResources(ctx context.Context, vmid int, cores, memoryMb int) error {
	f := url.Values{"cores": {fmt.Sprint(cores)}, "memory": {fmt.Sprint(memoryMb)}}
	return c.do(ctx, http.MethodPost, c.vmPath(vmid, "/config"), f, nil)
}

// SetConfig posts arbitrary config keys (used for floating IP NICs).
func (c *Client) SetConfig(ctx context.Context, vmid int, f url.Values) error {
	return c.do(ctx, http.MethodPost, c.vmPath(vmid, "/config"), f, nil)
}

// DeleteConfig removes config keys (comma separated list, as Proxmox accepts it).
func (c *Client) DeleteConfig(ctx context.Context, vmid int, keys ...string) error {
	return c.do(ctx, http.MethodPost, c.vmPath(vmid, "/config"), url.Values{"delete": {strings.Join(keys, ",")}}, nil)
}

// RegenerateCloudInit rebuilds the cloud-init drive so a changed ipconfig reaches the
// guest on its next cloud-init run. Older nodes without the endpoint are tolerated.
func (c *Client) RegenerateCloudInit(ctx context.Context, vmid int) error {
	err := c.do(ctx, http.MethodPut, c.vmPath(vmid, "/cloudinit"), url.Values{}, nil)
	var apiErr *APIError
	if errors.As(err, &apiErr) && (apiErr.Status == 501 || apiErr.Status == 404) {
		return nil
	}
	return err
}

func (c *Client) ResizeDisk(ctx context.Context, vmid int, diskGb int) error {
	f := url.Values{"disk": {"scsi0"}, "size": {fmt.Sprintf("%dG", diskGb)}}
	return c.do(ctx, http.MethodPut, c.vmPath(vmid, "/resize"), f, nil)
}

func (c *Client) Start(ctx context.Context, vmid int) error {
	return c.post(ctx, c.vmPath(vmid, "/status/start"), url.Values{}, 2*time.Minute)
}

func (c *Client) Shutdown(ctx context.Context, vmid int, force bool) error {
	if force {
		return c.post(ctx, c.vmPath(vmid, "/status/stop"), url.Values{}, 2*time.Minute)
	}
	return c.post(ctx, c.vmPath(vmid, "/status/shutdown"), url.Values{"timeout": {"60"}, "forceStop": {"1"}}, 3*time.Minute)
}

func (c *Client) Reboot(ctx context.Context, vmid int) error {
	return c.post(ctx, c.vmPath(vmid, "/status/reboot"), url.Values{"timeout": {"60"}}, 3*time.Minute)
}

func (c *Client) Delete(ctx context.Context, vmid int) error {
	req, _ := http.NewRequestWithContext(ctx, http.MethodDelete, c.cfg.URL+"/api2/json"+c.vmPath(vmid, "?purge=1&destroy-unreferenced-disks=1"), nil)
	req.Header.Set("Authorization", "PVEAPIToken="+c.cfg.TokenID+"="+c.cfg.TokenSecret)
	res, err := c.http.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	b, _ := io.ReadAll(res.Body)
	if res.StatusCode == 500 && strings.Contains(string(b), "does not exist") {
		return nil // idempotent
	}
	if res.StatusCode/100 != 2 {
		return &APIError{Status: res.StatusCode, Body: string(b)}
	}
	var env struct {
		Data string `json:"data"`
	}
	_ = json.Unmarshal(b, &env)
	if env.Data != "" {
		return c.waitTask(ctx, env.Data, 5*time.Minute)
	}
	return nil
}

type Status struct {
	Status string  `json:"status"` // running | stopped
	CPU    float64 `json:"cpu"`
	Mem    int64   `json:"mem"`
	Uptime int64   `json:"uptime"`
	NetIn  int64   `json:"netin"`
	NetOut int64   `json:"netout"`
}

func (c *Client) Status(ctx context.Context, vmid int) (*Status, error) {
	var s Status
	if err := c.do(ctx, http.MethodGet, c.vmPath(vmid, "/status/current"), nil, &s); err != nil {
		return nil, err
	}
	return &s, nil
}

// AgentPing returns nil once the QEMU guest agent answers — our "cloud-init done" signal
// (the golden images enable qemu-guest-agent as the last cloud-init step).
func (c *Client) AgentPing(ctx context.Context, vmid int) error {
	return c.do(ctx, http.MethodPost, c.vmPath(vmid, "/agent/ping"), url.Values{}, nil)
}

// GuestInterface is one entry of the guest agent's network-get-interfaces answer.
type GuestInterface struct {
	Name        string `json:"name"`
	MAC         string `json:"hardware-address"`
	IPAddresses []struct {
		Address string `json:"ip-address"`
		Type    string `json:"ip-address-type"` // ipv4 | ipv6
		Prefix  int    `json:"prefix"`
	} `json:"ip-addresses"`
}

// GuestInterfaces asks the QEMU guest agent for the guest's interfaces and addresses:
// GET /nodes/{node}/qemu/{vmid}/agent/network-get-interfaces. It fails while the guest
// agent is not running.
func (c *Client) GuestInterfaces(ctx context.Context, vmid int) ([]GuestInterface, error) {
	var out struct {
		Result []GuestInterface `json:"result"`
	}
	if err := c.do(ctx, http.MethodGet, c.vmPath(vmid, "/agent/network-get-interfaces"), nil, &out); err != nil {
		return nil, err
	}
	return out.Result, nil
}

func (c *Client) Snapshot(ctx context.Context, vmid int, name string) error {
	return c.post(ctx, c.vmPath(vmid, "/snapshot"), url.Values{"snapname": {name}, "vmstate": {"0"}}, 10*time.Minute)
}

// Rollback restores the VM disks to the snapshot (qm rollback). The VM must be stopped.
func (c *Client) Rollback(ctx context.Context, vmid int, name string) error {
	return c.post(ctx, c.vmPath(vmid, "/snapshot/"+name+"/rollback"), url.Values{}, 10*time.Minute)
}

func (c *Client) DeleteSnapshot(ctx context.Context, vmid int, name string) error {
	var upid string
	if err := c.do(ctx, http.MethodDelete, c.vmPath(vmid, "/snapshot/"+name), nil, &upid); err != nil {
		return err
	}
	return c.waitTask(ctx, upid, 10*time.Minute)
}

// ---- firewall (host-enforced, per VM) ----

type FWRule struct {
	Type   string // in | out
	Action string // ACCEPT | DROP
	Proto  string
	Dport  string
	Source string
	Dest   string
}

// SetFirewall replaces the VM's rule set and enables the firewall with default DROP in / ACCEPT out.
// ipfilter turns on the IP filter: each NIC may only send from the addresses in its
// ipfilter-net<N> IP set, and a NIC without such a set may send from none.
func (c *Client) SetFirewall(ctx context.Context, vmid int, rules []FWRule, ipfilter bool) error {
	opts := url.Values{"enable": {"1"}, "policy_in": {"DROP"}, "policy_out": {"ACCEPT"}, "dhcp": {"1"}, "ndp": {"1"}, "ipfilter": {"0"}}
	if ipfilter {
		opts.Set("ipfilter", "1")
	}
	if err := c.do(ctx, http.MethodPut, c.vmPath(vmid, "/firewall/options"), opts, nil); err != nil {
		return err
	}
	var existing []struct {
		Pos int `json:"pos"`
	}
	if err := c.do(ctx, http.MethodGet, c.vmPath(vmid, "/firewall/rules"), nil, &existing); err != nil {
		return err
	}
	for i := len(existing) - 1; i >= 0; i-- {
		req, _ := http.NewRequestWithContext(ctx, http.MethodDelete, c.cfg.URL+"/api2/json"+c.vmPath(vmid, fmt.Sprintf("/firewall/rules/%d", existing[i].Pos)), nil)
		req.Header.Set("Authorization", "PVEAPIToken="+c.cfg.TokenID+"="+c.cfg.TokenSecret)
		res, err := c.http.Do(req)
		if err != nil {
			return err
		}
		res.Body.Close()
	}
	for _, r := range rules {
		f := url.Values{"type": {r.Type}, "action": {r.Action}, "enable": {"1"}}
		if r.Proto != "" && r.Proto != "any" {
			f.Set("proto", r.Proto)
		}
		// Ports only mean something for tcp and udp; Proxmox rejects dport on other
		// protocols such as icmp or vrrp (IP protocol 112, used by keepalived).
		if r.Dport != "" && (r.Proto == "tcp" || r.Proto == "udp") {
			f.Set("dport", strings.ReplaceAll(r.Dport, "-", ":"))
		}
		if r.Source != "" {
			f.Set("source", r.Source)
		}
		if r.Dest != "" {
			f.Set("dest", r.Dest)
		}
		if err := c.do(ctx, http.MethodPost, c.vmPath(vmid, "/firewall/rules"), f, nil); err != nil {
			return err
		}
	}
	return nil
}

// FirewallOptions returns the VM's firewall options (enable, ipfilter, policy_in, ...).
func (c *Client) FirewallOptions(ctx context.Context, vmid int) (map[string]string, error) {
	var raw map[string]interface{}
	if err := c.do(ctx, http.MethodGet, c.vmPath(vmid, "/firewall/options"), nil, &raw); err != nil {
		return nil, err
	}
	out := map[string]string{}
	for k, v := range raw {
		out[k] = fmt.Sprint(v)
	}
	return out, nil
}

// SyncIPSet makes the VM's IP set hold exactly cidrs, creating the set when missing. The
// ipfilter-net<N> sets are what the IP filter allows a NIC to send from.
func (c *Client) SyncIPSet(ctx context.Context, vmid int, name string, cidrs []string) error {
	exists, err := c.hasIPSet(ctx, vmid, name)
	if err != nil {
		return err
	}
	if !exists {
		if err := c.do(ctx, http.MethodPost, c.vmPath(vmid, "/firewall/ipset"), url.Values{"name": {name}}, nil); err != nil {
			return err
		}
	}
	var entries []struct {
		CIDR string `json:"cidr"`
	}
	if err := c.do(ctx, http.MethodGet, c.vmPath(vmid, "/firewall/ipset/"+name), nil, &entries); err != nil {
		return err
	}
	want := map[string]bool{}
	for _, cidr := range cidrs {
		want[cidr] = true
	}
	have := map[string]bool{}
	for _, e := range entries {
		have[e.CIDR] = true
		if !want[e.CIDR] {
			if err := c.do(ctx, http.MethodDelete, c.vmPath(vmid, "/firewall/ipset/"+name+"/"+url.PathEscape(e.CIDR)), nil, nil); err != nil {
				return err
			}
		}
	}
	for _, cidr := range cidrs {
		if !have[cidr] {
			if err := c.do(ctx, http.MethodPost, c.vmPath(vmid, "/firewall/ipset/"+name), url.Values{"cidr": {cidr}}, nil); err != nil {
				return err
			}
		}
	}
	return nil
}

// DeleteIPSet removes the VM's IP set with its entries. A missing set is fine.
func (c *Client) DeleteIPSet(ctx context.Context, vmid int, name string) error {
	exists, err := c.hasIPSet(ctx, vmid, name)
	if err != nil || !exists {
		return err
	}
	return c.do(ctx, http.MethodDelete, c.vmPath(vmid, "/firewall/ipset/"+name+"?force=1"), nil, nil)
}

func (c *Client) hasIPSet(ctx context.Context, vmid int, name string) (bool, error) {
	var sets []struct {
		Name string `json:"name"`
	}
	if err := c.do(ctx, http.MethodGet, c.vmPath(vmid, "/firewall/ipset"), nil, &sets); err != nil {
		return false, err
	}
	for _, s := range sets {
		if s.Name == name {
			return true, nil
		}
	}
	return false, nil
}

// ---- SDN (cluster wide: one agent creates a VNet, every node gets its bridge) ----

// SDNZone returns the zone's type ("vxlan", "evpn", ...), or "" when the zone does not exist.
func (c *Client) SDNZone(ctx context.Context, zone string) (string, error) {
	var z struct {
		Type string `json:"type"`
	}
	if err := c.do(ctx, http.MethodGet, "/cluster/sdn/zones/"+url.PathEscape(zone), nil, &z); err != nil {
		if isMissing(err) {
			return "", nil
		}
		return "", err
	}
	return z.Type, nil
}

// VNet is an SDN VNet as the API returns it with pending=1; State is "new" or "changed" until
// the SDN config is applied.
type VNet struct {
	VNet  string `json:"vnet"`
	Zone  string `json:"zone"`
	Tag   int    `json:"tag"`
	State string `json:"state"`
}

// SDNVNet returns the VNet including pending changes, or nil when it does not exist.
func (c *Client) SDNVNet(ctx context.Context, vnet string) (*VNet, error) {
	var v VNet
	if err := c.do(ctx, http.MethodGet, "/cluster/sdn/vnets/"+url.PathEscape(vnet)+"?pending=1", nil, &v); err != nil {
		if isMissing(err) {
			return nil, nil
		}
		return nil, err
	}
	return &v, nil
}

// CreateVNet adds a VNet to a zone: POST /cluster/sdn/vnets. It exists only in the pending
// config until ApplySDN.
func (c *Client) CreateVNet(ctx context.Context, vnet, zone string, tag int, alias string) error {
	f := url.Values{"vnet": {vnet}, "zone": {zone}, "tag": {fmt.Sprint(tag)}}
	if alias != "" {
		f.Set("alias", alias)
	}
	return c.do(ctx, http.MethodPost, "/cluster/sdn/vnets", f, nil)
}

// ApplySDN applies the pending SDN config on every node (PUT /cluster/sdn) and waits for it.
func (c *Client) ApplySDN(ctx context.Context) error {
	var upid string
	if err := c.do(ctx, http.MethodPut, "/cluster/sdn", url.Values{}, &upid); err != nil {
		return err
	}
	if upid == "" {
		return nil
	}
	return c.waitTask(ctx, upid, 5*time.Minute)
}

func isMissing(err error) bool {
	var apiErr *APIError
	return errors.As(err, &apiErr) && (apiErr.Status == 404 || apiErr.Status == 500) && (strings.Contains(apiErr.Body, "does not exist") || strings.Contains(apiErr.Body, "no such"))
}

// ---- block volumes (Ceph RBD images owned by a reserved vmid) ----

// VolumeOwnerVMID is the pseudo owner of every customer volume image. Proxmox requires
// storage volumes to be named vm-<vmid>-...; using one reserved id keeps them apart from
// server disks and lets them move between VMs freely.
const VolumeOwnerVMID = 900000

// AllocVolume creates an image on the storage: POST /nodes/{node}/storage/{storage}/content.
func (c *Client) AllocVolume(ctx context.Context, name string, sizeGb int) (string, error) {
	f := url.Values{"filename": {name}, "size": {fmt.Sprintf("%dG", sizeGb)}, "vmid": {fmt.Sprint(VolumeOwnerVMID)}, "format": {"raw"}}
	var volid string
	if err := c.do(ctx, http.MethodPost, c.nodePath("/storage/"+c.cfg.Storage+"/content"), f, &volid); err != nil {
		return "", err
	}
	if volid == "" {
		volid = c.cfg.Storage + ":" + name
	}
	return volid, nil
}

// FreeVolume deletes an image: DELETE /nodes/{node}/storage/{storage}/content/{volid}.
func (c *Client) FreeVolume(ctx context.Context, volid string) error {
	req, _ := http.NewRequestWithContext(ctx, http.MethodDelete, c.cfg.URL+"/api2/json"+c.nodePath("/storage/"+c.cfg.Storage+"/content/"+url.PathEscape(volid)), nil)
	req.Header.Set("Authorization", "PVEAPIToken="+c.cfg.TokenID+"="+c.cfg.TokenSecret)
	res, err := c.http.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	b, _ := io.ReadAll(res.Body)
	if res.StatusCode == 500 && (strings.Contains(string(b), "does not exist") || strings.Contains(string(b), "No such")) {
		return nil
	}
	if res.StatusCode/100 != 2 {
		return &APIError{Status: res.StatusCode, Body: string(b)}
	}
	var env struct {
		Data string `json:"data"`
	}
	_ = json.Unmarshal(b, &env)
	if env.Data != "" {
		return c.waitTask(ctx, env.Data, 5*time.Minute)
	}
	return nil
}

// Config returns the VM's current config keys (scsi0, net0, ...).
func (c *Client) Config(ctx context.Context, vmid int) (map[string]string, error) {
	var raw map[string]interface{}
	if err := c.do(ctx, http.MethodGet, c.vmPath(vmid, "/config"), nil, &raw); err != nil {
		return nil, err
	}
	out := map[string]string{}
	for k, v := range raw {
		out[k] = fmt.Sprint(v)
	}
	return out, nil
}

// AttachDisk plugs an existing image into the first free scsi slot and returns the slot.
func (c *Client) AttachDisk(ctx context.Context, vmid int, volid, serial string) (string, error) {
	cfg, err := c.Config(ctx, vmid)
	if err != nil {
		return "", err
	}
	for _, kv := range cfg {
		if strings.Contains(kv, volid) {
			for k, v := range cfg { // already attached: idempotent
				if v == kv && strings.HasPrefix(k, "scsi") {
					return k, nil
				}
			}
		}
	}
	slot := ""
	for i := 1; i <= 30; i++ {
		if _, used := cfg[fmt.Sprintf("scsi%d", i)]; !used {
			slot = fmt.Sprintf("scsi%d", i)
			break
		}
	}
	if slot == "" {
		return "", &APIError{Status: 400, Body: "no free scsi slot"}
	}
	f := url.Values{slot: {volid + ",backup=0,serial=" + serial}}
	return slot, c.do(ctx, http.MethodPost, c.vmPath(vmid, "/config"), f, nil)
}

// DetachDisk removes the slot that carries volid. The image itself stays on storage.
func (c *Client) DetachDisk(ctx context.Context, vmid int, volid string) error {
	cfg, err := c.Config(ctx, vmid)
	if err != nil {
		return err
	}
	for k, v := range cfg {
		if strings.HasPrefix(k, "scsi") && strings.Contains(v, volid) {
			return c.do(ctx, http.MethodPost, c.vmPath(vmid, "/config"), url.Values{"delete": {k}}, nil)
		}
	}
	return nil // not attached: idempotent
}

// ResizeAttachedDisk grows a plugged disk (the guest sees it immediately).
func (c *Client) ResizeAttachedDisk(ctx context.Context, vmid int, volid string, sizeGb int) error {
	cfg, err := c.Config(ctx, vmid)
	if err != nil {
		return err
	}
	for k, v := range cfg {
		if strings.HasPrefix(k, "scsi") && strings.Contains(v, volid) {
			return c.do(ctx, http.MethodPut, c.vmPath(vmid, "/resize"), url.Values{"disk": {k}, "size": {fmt.Sprintf("%dG", sizeGb)}}, nil)
		}
	}
	return &APIError{Status: 400, Body: "volume is not attached to this vm"}
}

// ---- node capacity ----

type NodeStatus struct {
	CPUInfo struct {
		Cpus int `json:"cpus"`
	} `json:"cpuinfo"`
	Memory struct {
		Total int64 `json:"total"`
		Used  int64 `json:"used"`
	} `json:"memory"`
}

func (c *Client) NodeStatus(ctx context.Context) (*NodeStatus, error) {
	var s NodeStatus
	if err := c.do(ctx, http.MethodGet, c.nodePath("/status"), nil, &s); err != nil {
		return nil, err
	}
	return &s, nil
}

type StorageStatus struct {
	Total int64 `json:"total"`
	Used  int64 `json:"used"`
}

func (c *Client) StorageStatus(ctx context.Context) (*StorageStatus, error) {
	var s StorageStatus
	if err := c.do(ctx, http.MethodGet, c.nodePath("/storage/"+c.cfg.Storage+"/status"), nil, &s); err != nil {
		return nil, err
	}
	return &s, nil
}

type VMListEntry struct {
	VMID      int     `json:"vmid"`
	Name      string  `json:"name"`
	Status    string  `json:"status"`
	Cpus      int     `json:"cpus"`
	MaxMem    int64   `json:"maxmem"`
	Mem       int64   `json:"mem"`
	DiskRead  int64   `json:"diskread"`
	DiskWrite int64   `json:"diskwrite"`
	Tags      string  `json:"tags"`
	CPU       float64 `json:"cpu"`
	NetIn     int64   `json:"netin"`
	NetOut    int64   `json:"netout"`
	Template  int     `json:"template"`
	Uptime    int64   `json:"uptime"`
}

func (c *Client) ListVMs(ctx context.Context) ([]VMListEntry, error) {
	var vms []VMListEntry
	if err := c.do(ctx, http.MethodGet, c.nodePath("/qemu"), nil, &vms); err != nil {
		return nil, err
	}
	return vms, nil
}

// WriteSnippet stores cloud-init user-data on the node's snippets storage via the
// PVE file API is not available; the agent writes it to the local snippets dir instead.
func (c *Client) SnippetRef(vmid int) string {
	return "local:snippets/pgcloud-" + fmt.Sprint(vmid) + "-user.yaml"
}
