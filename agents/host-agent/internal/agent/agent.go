// Package agent wires NATS jobs to the Proxmox client and publishes heartbeats + usage.
package agent

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/nats-io/nats.go"

	"github.com/prgd/host-agent/internal/config"
	"github.com/prgd/host-agent/internal/protocol"
	"github.com/prgd/host-agent/internal/proxmox"
)

// snippetsDir is where cloud-init user-data lands so Proxmox can serve it as a snippet.
// PRGD_SNIPPETS_DIR overrides it (the test harness points it at a temp dir).
func snippetsDir() string {
	if d := os.Getenv("PRGD_SNIPPETS_DIR"); d != "" {
		return d
	}
	return "/var/lib/vz/snippets"
}

type Agent struct {
	cfg     *config.Config
	pve     *proxmox.Client
	nc      *nats.Conn
	log     *slog.Logger
	version string

	jobs   map[string]*jobEntry // job de-dup by id
	jobsMu sync.Mutex

	// netOut is the last outbound byte counter seen per vmid, so bandwidth usage is sent as
	// the delta per tick. Only the tick loop touches it.
	netOut map[int]int64

	// guest caches the addresses the guest agent reported per vmid for the heartbeat, so a
	// tick does not ask every guest every minute. Only the tick loop touches it.
	guest map[int]guestAddrs
}

type guestAddrs struct {
	addrs []string
	until time.Time
}

// How long heartbeat address readings are reused. A guest that does not answer after
// guestBootGrace has no guest agent, so it is asked less often; one that is still booting is
// asked again on the next tick.
const (
	guestAddrsTTL     = 5 * time.Minute
	guestAddrsFailTTL = 2 * time.Minute
	guestBootGrace    = 10 * time.Minute
)

// jobEntry tracks one job id. done closes when the job finishes; res is valid after that.
// Successful results are kept for jobRetention so a retried request with the same id gets
// the stored answer instead of running the job again (a second clone would orphan a VM).
type jobEntry struct {
	done     chan struct{}
	res      protocol.JobResult
	finished time.Time
}

// jobRetention is how long a completed job's result is kept for repeated ids.
const jobRetention = time.Hour

func New(cfg *config.Config, pve *proxmox.Client, version string, log *slog.Logger) (*Agent, error) {
	opts := []nats.Option{
		nats.Name("prgd-agent-" + cfg.Proxmox.Node),
		nats.MaxReconnects(-1),
		nats.ReconnectWait(2 * time.Second),
	}
	if cfg.NATSCreds != "" {
		opts = append(opts, nats.UserCredentials(cfg.NATSCreds))
	}
	if tok := firstNonEmpty(os.Getenv("NATS_TOKEN"), cfg.NATSToken); tok != "" {
		opts = append(opts, nats.Token(tok))
	}
	nc, err := nats.Connect(cfg.NATSURL, opts...)
	if err != nil {
		return nil, fmt.Errorf("nats: %w", err)
	}
	return &Agent{cfg: cfg, pve: pve, nc: nc, log: log.With("node", cfg.Proxmox.Node), version: version, jobs: map[string]*jobEntry{}, netOut: map[int]int64{}, guest: map[int]guestAddrs{}}, nil
}

func (a *Agent) Run(ctx context.Context) error {
	subject := "prgd.host." + a.cfg.HostID + ".jobs"
	sub, err := a.nc.QueueSubscribe(subject, "agent", func(m *nats.Msg) { go a.handle(ctx, m) })
	if err != nil {
		return err
	}
	defer sub.Unsubscribe()
	a.log.Info("agent up", "version", a.version, "subject", subject)

	t := time.NewTicker(a.cfg.Heartbeat)
	defer t.Stop()
	a.tick(ctx)
	for {
		select {
		case <-ctx.Done():
			return a.nc.Drain()
		case <-t.C:
			a.tick(ctx)
		}
	}
}

// tick publishes one heartbeat and one usage event per running VM.
func (a *Agent) tick(ctx context.Context) {
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	now := time.Now().UTC().Truncate(time.Minute)

	vms, err := a.pve.ListVMs(ctx)
	if err != nil {
		a.log.Warn("list vms", "err", err)
		return
	}
	node, err := a.pve.NodeStatus(ctx)
	if err != nil {
		a.log.Warn("node status", "err", err)
		return
	}
	st, _ := a.pve.StorageStatus(ctx)

	hb := protocol.Heartbeat{
		HostID: a.cfg.HostID, Node: a.cfg.Proxmox.Node, At: now.Format(time.RFC3339),
		TotalVcpu: node.CPUInfo.Cpus, TotalMemoryMb: node.Memory.Total >> 20, AgentVersion: a.version,
	}
	if st != nil {
		hb.TotalDiskGb = st.Total >> 30
		hb.UsedDiskGb = st.Used >> 30
	}
	seen := map[int]bool{}
	for _, vm := range vms {
		if vm.Template == 1 {
			continue
		}
		seen[vm.VMID] = true
		ref := refFromTags(vm.VMID, a.cfg.Proxmox.Node, vm.Tags)
		refJSON, _ := json.Marshal(ref)
		brief := protocol.VmBrief{VmRef: string(refJSON), Power: vm.Status, ServerID: ref.ServerID}
		if vm.Status == "running" && ref.ServerID != "" {
			brief.Addresses = a.cachedGuestAddresses(ctx, vm.VMID, vm.Uptime)
		}
		hb.Vms = append(hb.Vms, brief)
		hb.UsedVcpu += vm.Cpus
		hb.UsedMemoryMb += vm.MaxMem >> 20

		// Servers are metered whenever they exist (running or off), like the control plane fallback.
		if ref.ServerID != "" {
			a.publish("prgd.usage", protocol.UsageEvent{
				V: 1, At: now.Format(time.RFC3339), ResourceType: "server", ResourceID: ref.ServerID, ProjectID: ref.ProjectID,
				HostID: a.cfg.HostID, Quantity: 1, Unit: "minute", Meta: map[string]interface{}{"power": vm.Status, "cpu": vm.CPU},
			})
			a.publish("prgd.metrics", protocol.MetricSample{
				V: 1, At: now.Format(time.RFC3339), ServerID: ref.ServerID, HostID: a.cfg.HostID, Power: vm.Status,
				CpuPercent: vm.CPU * 100, MemoryUsedMb: vm.Mem >> 20, MemoryTotalMb: vm.MaxMem >> 20,
				NetInBytes: vm.NetIn, NetOutBytes: vm.NetOut, DiskReadBytes: vm.DiskRead, DiskWriteBytes: vm.DiskWrite,
			})
			if delta := a.netOutDelta(vm.VMID, vm.NetOut); delta > 0 {
				a.publish("prgd.usage", protocol.UsageEvent{
					V: 1, At: now.Format(time.RFC3339), ResourceType: "bandwidth", ResourceID: ref.ServerID, ProjectID: ref.ProjectID,
					HostID: a.cfg.HostID, Quantity: float64(delta), Unit: "byte", Meta: map[string]interface{}{"delta": true},
				})
			}
		}
	}
	for vmid := range a.netOut {
		if !seen[vmid] {
			delete(a.netOut, vmid)
		}
	}
	for vmid := range a.guest {
		if !seen[vmid] {
			delete(a.guest, vmid)
		}
	}
	a.publish("prgd.host."+a.cfg.HostID+".heartbeat", hb)
}

// netOutDelta returns the outbound bytes since the previous tick. The counter restarts at
// zero when the VM boots again, so a smaller value than last time is all new traffic. The
// first reading only sets the baseline, so an agent restart never bills since boot bytes twice.
func (a *Agent) netOutDelta(vmid int, counter int64) int64 {
	last, known := a.netOut[vmid]
	a.netOut[vmid] = counter
	switch {
	case !known:
		return 0
	case counter < last:
		return counter
	default:
		return counter - last
	}
}

func (a *Agent) publish(subject string, v interface{}) {
	b, _ := json.Marshal(v)
	if err := a.nc.Publish(subject, b); err != nil {
		a.log.Warn("publish", "subject", subject, "err", err)
	}
}

// ---- jobs ----

func (a *Agent) handle(ctx context.Context, m *nats.Msg) {
	var job protocol.Job
	if err := json.Unmarshal(m.Data, &job); err != nil {
		a.reply(m, protocol.JobResult{OK: false, Error: &protocol.JobError{Code: "bad_job", Message: err.Error()}})
		return
	}
	entry, first := a.claim(job.ID)
	if !first {
		// A repeated id waits for the running job, or gets the stored result of a finished one.
		a.log.Info("repeated job id, answering with its result", "id", job.ID, "kind", job.Kind)
		select {
		case <-entry.done:
			a.reply(m, entry.res)
		case <-ctx.Done():
		}
		return
	}
	res := a.run(ctx, job)
	a.finish(job.ID, entry, res)
	a.reply(m, res)
}

// run executes one job and turns its outcome into a JobResult.
func (a *Agent) run(ctx context.Context, job protocol.Job) protocol.JobResult {
	log := a.log.With("job", job.ID, "kind", job.Kind)
	log.Info("job start")
	ctx, cancel := context.WithTimeout(ctx, 20*time.Minute)
	defer cancel()

	res, err := a.dispatch(ctx, job, log)
	if err != nil {
		je := &protocol.JobError{Code: "job_failed", Message: err.Error(), Retryable: true}
		var apiErr *proxmox.APIError
		if errors.As(err, &apiErr) {
			je.Code = fmt.Sprintf("proxmox_%d", apiErr.Status)
			je.Retryable = apiErr.Retryable()
		}
		var perm permanent
		if errors.As(err, &perm) {
			je.Code = perm.code
			je.Retryable = false
		}
		log.Error("job failed", "err", err, "retryable", je.Retryable)
		return protocol.JobResult{JobID: job.ID, OK: false, Error: je}
	}
	log.Info("job done")
	return protocol.JobResult{JobID: job.ID, OK: true, Result: res}
}

func (a *Agent) reply(m *nats.Msg, r protocol.JobResult) {
	b, _ := json.Marshal(r)
	if err := m.Respond(b); err != nil {
		a.log.Warn("reply", "err", err)
	}
}

// claim registers a job id. It returns the entry and true when this caller must run the
// job, or the existing entry and false when the id is running or finished already.
func (a *Agent) claim(id string) (*jobEntry, bool) {
	a.jobsMu.Lock()
	defer a.jobsMu.Unlock()
	for k, e := range a.jobs {
		if !e.finished.IsZero() && time.Since(e.finished) > jobRetention {
			delete(a.jobs, k)
		}
	}
	if e, ok := a.jobs[id]; ok {
		return e, false
	}
	e := &jobEntry{done: make(chan struct{})}
	a.jobs[id] = e
	return e, true
}

// finish stores the result and wakes requests waiting on the same id. Failed jobs are
// forgotten once the waiters have their answer, so a retry with the same id runs again.
func (a *Agent) finish(id string, e *jobEntry, res protocol.JobResult) {
	a.jobsMu.Lock()
	defer a.jobsMu.Unlock()
	e.res = res
	e.finished = time.Now()
	if !res.OK {
		delete(a.jobs, id)
	}
	close(e.done)
}

type permanent struct {
	code string
	err  error
}

func (p permanent) Error() string { return p.err.Error() }

func (a *Agent) dispatch(ctx context.Context, job protocol.Job, log *slog.Logger) (interface{}, error) {
	switch job.Kind {
	case protocol.JobCreate:
		var p struct {
			Spec protocol.VmSpec `json:"spec"`
		}
		if err := json.Unmarshal(job.Params, &p); err != nil {
			return nil, permanent{"bad_params", err}
		}
		return a.create(ctx, p.Spec, log)

	case protocol.JobWaitBoot:
		var p struct {
			VmRef     string `json:"vmRef"`
			TimeoutMs int    `json:"timeoutMs"`
		}
		json.Unmarshal(job.Params, &p)
		ref, err := parseRef(p.VmRef)
		if err != nil {
			return nil, err
		}
		return a.waitBoot(ctx, ref.VMID, time.Duration(p.TimeoutMs)*time.Millisecond)

	case protocol.JobStart, protocol.JobStop, protocol.JobReboot, protocol.JobDelete, protocol.JobStatus:
		var p struct {
			VmRef string `json:"vmRef"`
			Force bool   `json:"force"`
		}
		json.Unmarshal(job.Params, &p)
		ref, err := parseRef(p.VmRef)
		if err != nil {
			return nil, err
		}
		switch job.Kind {
		case protocol.JobStart:
			return nil, a.pve.Start(ctx, ref.VMID)
		case protocol.JobStop:
			return nil, a.pve.Shutdown(ctx, ref.VMID, p.Force)
		case protocol.JobReboot:
			return nil, a.pve.Reboot(ctx, ref.VMID)
		case protocol.JobDelete:
			os.Remove(filepath.Join(snippetsDir(), fmt.Sprintf("prgd-%d-user.yaml", ref.VMID)))
			return nil, a.pve.Delete(ctx, ref.VMID)
		default:
			return a.status(ctx, ref.VMID)
		}

	case protocol.JobFindByTag:
		var p struct {
			Tag string `json:"tag"`
		}
		if err := json.Unmarshal(job.Params, &p); err != nil || p.Tag == "" {
			return nil, permanent{"bad_params", fmt.Errorf("tag is required")}
		}
		return a.findByTag(ctx, p.Tag)

	case protocol.JobResize:
		var p struct {
			VmRef    string `json:"vmRef"`
			Vcpu     int    `json:"vcpu"`
			MemoryMb int    `json:"memoryMb"`
			DiskGb   int    `json:"diskGb"`
		}
		json.Unmarshal(job.Params, &p)
		ref, err := parseRef(p.VmRef)
		if err != nil {
			return nil, err
		}
		// Only cores, memory and the disk change. Resending name, tags or net0 would wipe the
		// attribution tags and give the NIC a new MAC address.
		if err := a.pve.SetResources(ctx, ref.VMID, p.Vcpu, p.MemoryMb); err != nil {
			return nil, err
		}
		if p.DiskGb <= 0 {
			return nil, nil
		}
		return nil, a.pve.ResizeDisk(ctx, ref.VMID, p.DiskGb)

	case protocol.JobSnapshot:
		var p struct {
			VmRef      string `json:"vmRef"`
			SnapshotID string `json:"snapshotId"`
		}
		json.Unmarshal(job.Params, &p)
		ref, err := parseRef(p.VmRef)
		if err != nil {
			return nil, err
		}
		name := "prgd" + strings.ToLower(p.SnapshotID)
		if err := a.pve.Snapshot(ctx, ref.VMID, name); err != nil {
			return nil, err
		}
		sref, _ := json.Marshal(protocol.SnapshotRef{VMID: ref.VMID, Node: ref.Node, Name: name})
		return map[string]interface{}{"snapshotRef": string(sref), "sizeGb": a.snapshotSizeGb(ctx, ref.VMID, name, log)}, nil

	case protocol.JobRollback:
		var p struct {
			VmRef       string `json:"vmRef"`
			SnapshotRef string `json:"snapshotRef"`
		}
		json.Unmarshal(job.Params, &p)
		ref, err := parseRef(p.VmRef)
		if err != nil {
			return nil, err
		}
		var snap protocol.SnapshotRef
		if err := json.Unmarshal([]byte(p.SnapshotRef), &snap); err != nil || snap.Name == "" {
			return nil, permanent{"bad_ref", fmt.Errorf("invalid snapshotRef %q", p.SnapshotRef)}
		}
		if snap.VMID != ref.VMID {
			return nil, permanent{"bad_ref", fmt.Errorf("snapshot %s belongs to vm %d, not %d", snap.Name, snap.VMID, ref.VMID)}
		}
		return nil, a.pve.Rollback(ctx, ref.VMID, snap.Name)

	case protocol.JobSnapshotDel:
		var p struct {
			SnapshotRef string `json:"snapshotRef"`
		}
		json.Unmarshal(job.Params, &p)
		var s protocol.SnapshotRef
		if err := json.Unmarshal([]byte(p.SnapshotRef), &s); err != nil {
			return nil, permanent{"bad_ref", err}
		}
		return nil, a.pve.DeleteSnapshot(ctx, s.VMID, s.Name)

	case protocol.JobApplyFirewall:
		var p struct {
			VmRef string                  `json:"vmRef"`
			Rules []protocol.FirewallRule `json:"rules"`
			// Deny are drop rules (platform guard rails: tenant isolation, SMTP), placed above
			// every accept rule. A separate list so control planes and agents that predate it
			// never mistake a drop for an accept.
			Deny []protocol.FirewallRule `json:"deny"`
			// Addresses each NIC may send from ("net0": private, "net1": public and VIPs).
			// Absent from older control planes: the IP filter then stays off.
			Addresses map[string][]string `json:"addresses"`
		}
		json.Unmarshal(job.Params, &p)
		ref, err := parseRef(p.VmRef)
		if err != nil {
			return nil, err
		}
		return nil, a.applyFirewall(ctx, ref.VMID, append(toPVERules(p.Deny, "DROP"), toPVERules(p.Rules, "ACCEPT")...), p.Addresses, log)

	case protocol.JobEnsureVNet:
		var p protocol.VNetSpec
		if err := json.Unmarshal(job.Params, &p); err != nil || p.VNet == "" || p.Zone == "" || p.Tag <= 0 {
			return nil, permanent{"bad_params", fmt.Errorf("vnet, zone and tag are required")}
		}
		return a.ensureVNet(ctx, p)

	case protocol.JobVolumeCreate:
		var p struct {
			VolumeID string `json:"volumeId"`
			SizeGb   int    `json:"sizeGb"`
		}
		if err := json.Unmarshal(job.Params, &p); err != nil || p.VolumeID == "" || p.SizeGb <= 0 {
			return nil, permanent{"bad_params", fmt.Errorf("volumeId and sizeGb are required")}
		}
		name := "vm-" + fmt.Sprint(proxmox.VolumeOwnerVMID) + "-vol-" + strings.ToLower(p.VolumeID)
		volid, err := a.pve.AllocVolume(ctx, name, p.SizeGb)
		if err != nil {
			return nil, err
		}
		ref, _ := json.Marshal(protocol.VolumeRef{Storage: a.cfg.Proxmox.Storage, Volume: strings.TrimPrefix(volid, a.cfg.Proxmox.Storage+":")})
		return map[string]interface{}{"volumeRef": string(ref)}, nil

	case protocol.JobVolumeAttach, protocol.JobVolumeDetach, protocol.JobVolumeResize, protocol.JobVolumeDelete:
		var p struct {
			VmRef     string `json:"vmRef"`
			VolumeRef string `json:"volumeRef"`
			Serial    string `json:"serial"`
			SizeGb    int    `json:"sizeGb"`
		}
		json.Unmarshal(job.Params, &p)
		var vol protocol.VolumeRef
		if err := json.Unmarshal([]byte(p.VolumeRef), &vol); err != nil || vol.Volume == "" {
			return nil, permanent{"bad_ref", fmt.Errorf("invalid volumeRef %q", p.VolumeRef)}
		}
		volid := vol.Storage + ":" + vol.Volume
		switch job.Kind {
		case protocol.JobVolumeAttach:
			ref, err := parseRef(p.VmRef)
			if err != nil {
				return nil, err
			}
			serial := p.Serial
			if len(serial) > 20 {
				serial = serial[:20]
			}
			slot, err := a.pve.AttachDisk(ctx, ref.VMID, volid, serial)
			if err != nil {
				return nil, err
			}
			return map[string]interface{}{"device": "/dev/disk/by-id/scsi-0QEMU_QEMU_HARDDISK_" + serial, "slot": slot}, nil
		case protocol.JobVolumeDetach:
			ref, err := parseRef(p.VmRef)
			if err != nil {
				return nil, err
			}
			return nil, a.pve.DetachDisk(ctx, ref.VMID, volid)
		case protocol.JobVolumeResize:
			if p.SizeGb <= 0 {
				return nil, permanent{"bad_params", fmt.Errorf("sizeGb is required")}
			}
			if p.VmRef != "" {
				ref, err := parseRef(p.VmRef)
				if err != nil {
					return nil, err
				}
				return nil, a.pve.ResizeAttachedDisk(ctx, ref.VMID, volid, p.SizeGb)
			}
			// Detached images have no Proxmox API for resize; use the storage's own tool on the node.
			if a.cfg.Proxmox.StorageType == config.StorageLVMThin {
				return nil, lvResize(ctx, volid, p.SizeGb)
			}
			pool := a.cfg.Proxmox.CephPool
			if pool == "" {
				pool = vol.Storage
			}
			return nil, rbdResize(ctx, pool, vol.Volume, p.SizeGb)
		default:
			return nil, a.pve.FreeVolume(ctx, volid)
		}

	case protocol.JobAttachIP, protocol.JobDetachIP:
		var p struct {
			VmRef   string             `json:"vmRef"`
			IP      *protocol.PublicIP `json:"ip"`
			Address string             `json:"address"`
		}
		json.Unmarshal(job.Params, &p)
		ref, err := parseRef(p.VmRef)
		if err != nil {
			return nil, err
		}
		if job.Kind == protocol.JobAttachIP {
			if p.IP == nil || p.IP.Address == "" || p.IP.Prefix == 0 {
				return nil, permanent{"bad_params", fmt.Errorf("ip with address, gateway and prefix is required")}
			}
			return nil, a.attachIP(ctx, ref.VMID, *p.IP)
		}
		if p.Address == "" {
			return nil, permanent{"bad_params", fmt.Errorf("address is required")}
		}
		return nil, a.detachIP(ctx, ref.VMID, p.Address)

	default:
		return nil, permanent{"unknown_job", fmt.Errorf("unknown job kind %q", job.Kind)}
	}
}

func (a *Agent) create(ctx context.Context, spec protocol.VmSpec, log *slog.Logger) (interface{}, error) {
	// A template ref clones the golden image; a snapshot ref clones the source VM's snapshot.
	var img struct {
		Template int    `json:"template"`
		VMID     int    `json:"vmid"`
		Node     string `json:"node"`
		Name     string `json:"name"`
	}
	if err := json.Unmarshal([]byte(spec.ImageRef), &img); err != nil || (img.Template == 0 && (img.VMID == 0 || img.Name == "")) {
		return nil, permanent{"bad_image_ref", fmt.Errorf("imageRef %q is neither a template nor a snapshot ref", spec.ImageRef)}
	}
	if img.Template == 0 && img.Node != "" && img.Node != a.cfg.Proxmox.Node {
		return nil, permanent{"wrong_node", fmt.Errorf("snapshot %s lives on node %s, not %s", img.Name, img.Node, a.cfg.Proxmox.Node)}
	}
	vmid, err := a.pve.NextID(ctx)
	if err != nil {
		return nil, err
	}
	log = log.With("vmid", vmid)
	if img.Template != 0 {
		err = a.pve.Clone(ctx, img.Template, vmid, spec.Name)
	} else {
		err = a.pve.CloneSnapshot(ctx, img.VMID, img.Name, vmid, spec.Name)
	}
	if err != nil {
		return nil, err
	}

	userDataRef := ""
	if spec.UserData != "" {
		// The snippet replaces the user-data Proxmox would generate, so it must carry the keys and hostname.
		userData, err := renderUserData(spec.UserData, spec.Hostname, spec.SshKeys)
		if err != nil {
			log.Warn("render user-data", "err", err)
			userData = spec.UserData
		}
		if err := os.MkdirAll(snippetsDir(), 0o755); err == nil {
			path := filepath.Join(snippetsDir(), fmt.Sprintf("prgd-%d-user.yaml", vmid))
			if err := os.WriteFile(path, []byte(userData), 0o600); err == nil {
				userDataRef = a.pve.SnippetRef(vmid)
			} else {
				log.Warn("write user-data snippet", "err", err)
			}
		}
	}

	cfg := proxmox.VMConfig{
		Cores: spec.Vcpu, MemoryMb: spec.MemoryMb, SSHKeys: spec.SshKeys, UserData: userDataRef, Hostname: spec.Hostname,
		PrivateIP: "dhcp", Bridge: a.cfg.Proxmox.Bridge, PublicBr: a.cfg.Proxmox.PublicBridge,
		Tags: "prgd;server-" + spec.ServerID + ";project-" + strings.TrimPrefix(spec.NetworkRef, "vpc-"),
	}
	if spec.PrivateBridge != "" {
		// The project's own VNet; VXLAN leaves 1450 bytes, which the NIC takes from the bridge.
		cfg.Bridge, cfg.BridgeMTU = spec.PrivateBridge, true
	}
	if spec.PrivateIP != nil && spec.PrivateIP.Address != "" && spec.PrivateIP.Prefix > 0 {
		// A static address known before boot; the private NIC gets no gateway.
		cfg.PrivateIP = fmt.Sprintf("%s/%d", spec.PrivateIP.Address, spec.PrivateIP.Prefix)
	}
	if spec.PublicIP != nil {
		cfg.PublicIP = fmt.Sprintf("%s/%d", spec.PublicIP.Address, spec.PublicIP.Prefix)
		cfg.Gateway = spec.PublicIP.Gateway
	}
	if err := a.pve.Configure(ctx, vmid, cfg); err != nil {
		_ = a.pve.Delete(ctx, vmid)
		return nil, err
	}
	if err := a.pve.ResizeDisk(ctx, vmid, spec.DiskGb); err != nil {
		_ = a.pve.Delete(ctx, vmid)
		return nil, err
	}
	if err := a.pve.Start(ctx, vmid); err != nil {
		_ = a.pve.Delete(ctx, vmid)
		return nil, err
	}
	ref, _ := json.Marshal(protocol.VmRef{VMID: vmid, Node: a.cfg.Proxmox.Node, ServerID: spec.ServerID, ProjectID: strings.TrimPrefix(spec.NetworkRef, "vpc-")})
	h := protocol.VmHandle{VmRef: string(ref)}
	if spec.PrivateIP != nil {
		h.PrivateIP = spec.PrivateIP.Address
	}
	return h, nil
}

// attachIP puts a public address on the VM's public NIC (net1) and its cloud-init network
// config (ipconfig1), keeping the NIC's MAC when it already exists. Proxmox hot plugs the
// NIC; the guest applies the address from the regenerated cloud-init drive on its next boot.
func (a *Agent) attachIP(ctx context.Context, vmid int, ip protocol.PublicIP) error {
	cfg, err := a.pve.Config(ctx, vmid)
	if err != nil {
		return err
	}
	nic := "virtio,bridge=" + a.cfg.Proxmox.PublicBridge + ",firewall=1"
	if model := strings.SplitN(cfg["net1"], ",", 2)[0]; strings.HasPrefix(model, "virtio=") {
		nic = model + ",bridge=" + a.cfg.Proxmox.PublicBridge + ",firewall=1"
	}
	ipconfig := fmt.Sprintf("ip=%s/%d", ip.Address, ip.Prefix)
	if ip.Gateway != "" {
		ipconfig += ",gw=" + ip.Gateway
	}
	if err := a.pve.SetConfig(ctx, vmid, url.Values{"net1": {nic}, "ipconfig1": {ipconfig}}); err != nil {
		return err
	}
	// With the IP filter on, a NIC without its IP set may send from nothing: give net1 the address.
	if opts, err := a.pve.FirewallOptions(ctx, vmid); err != nil {
		return err
	} else if opts["ipfilter"] == "1" {
		if err := a.pve.SyncIPSet(ctx, vmid, "ipfilter-net1", []string{ip.Address}); err != nil {
			return err
		}
	}
	return a.pve.RegenerateCloudInit(ctx, vmid)
}

// detachIP removes the public NIC when it carries the address. Idempotent: a VM without the
// address is left alone.
func (a *Agent) detachIP(ctx context.Context, vmid int, address string) error {
	cfg, err := a.pve.Config(ctx, vmid)
	if err != nil {
		return err
	}
	if !strings.HasPrefix(cfg["ipconfig1"], "ip="+address+"/") {
		return nil
	}
	if err := a.pve.DeleteConfig(ctx, vmid, "net1", "ipconfig1"); err != nil {
		return err
	}
	if err := a.pve.DeleteIPSet(ctx, vmid, "ipfilter-net1"); err != nil {
		return err
	}
	return a.pve.RegenerateCloudInit(ctx, vmid)
}

// applyFirewall sets the rules and the IP filter. A NIC gets an ipfilter-net<N> IP set only
// when its cloud-init config carries a static address that is among the addresses the control
// plane sent for it; the filter option goes on only when every NIC has one. A NIC still on
// DHCP (a server from before static addresses, or one rolled back to such a snapshot) is left
// unfiltered, since filtering it would cut it off.
func (a *Agent) applyFirewall(ctx context.Context, vmid int, rules []proxmox.FWRule, addrs map[string][]string, log *slog.Logger) error {
	if addrs == nil {
		return a.pve.SetFirewall(ctx, vmid, rules, false)
	}
	cfg, err := a.pve.Config(ctx, vmid)
	if err != nil {
		return err
	}
	var nics []string
	for k := range cfg {
		if n, ok := strings.CutPrefix(k, "net"); ok && n != "" && strings.Trim(n, "0123456789") == "" {
			nics = append(nics, k)
		}
	}
	sets := map[string][]string{}
	all := true
	for _, k := range nics {
		static := staticAddress(cfg["ipconfig"+strings.TrimPrefix(k, "net")])
		if static != "" && containsString(addrs[k], static) {
			sets[k] = addrs[k]
		} else {
			all = false
			log.Warn("ip filter left off for a nic without a matching static address", "nic", k, "ipconfig", cfg["ipconfig"+strings.TrimPrefix(k, "net")], "allowed", addrs[k])
		}
	}
	enable := all && len(sets) > 0
	if !enable {
		// Turn the filter off before removing sets, so no NIC is ever filtered with an empty set.
		if err := a.pve.SetFirewall(ctx, vmid, rules, false); err != nil {
			return err
		}
	}
	for _, k := range nics {
		if list, ok := sets[k]; ok {
			err = a.pve.SyncIPSet(ctx, vmid, "ipfilter-"+k, list)
		} else {
			err = a.pve.DeleteIPSet(ctx, vmid, "ipfilter-"+k)
		}
		if err != nil {
			return err
		}
	}
	if enable {
		return a.pve.SetFirewall(ctx, vmid, rules, true)
	}
	return nil
}

// ensureVNet creates the project's VNet in the VXLAN zone when it is missing and applies the
// SDN config, which creates the VNet's bridge on every node of the cluster. Idempotent: an
// existing VNet with the same zone and tag is applied only when it still has pending changes.
func (a *Agent) ensureVNet(ctx context.Context, p protocol.VNetSpec) (interface{}, error) {
	zoneType, err := a.pve.SDNZone(ctx, p.Zone)
	if err != nil {
		return nil, err
	}
	if zoneType == "" {
		return nil, permanent{"sdn_zone_missing", fmt.Errorf("SDN zone %q does not exist; create it on the cluster first", p.Zone)}
	}
	if zoneType != "vxlan" && zoneType != "evpn" {
		return nil, permanent{"sdn_zone_type", fmt.Errorf("SDN zone %q is %s, not vxlan or evpn", p.Zone, zoneType)}
	}
	v, err := a.pve.SDNVNet(ctx, p.VNet)
	if err != nil {
		return nil, err
	}
	created := false
	switch {
	case v == nil:
		if err := a.pve.CreateVNet(ctx, p.VNet, p.Zone, p.Tag, p.Alias); err != nil {
			return nil, err
		}
		created = true
	case v.Zone != p.Zone || v.Tag != p.Tag:
		return nil, permanent{"sdn_vnet_conflict", fmt.Errorf("VNet %s exists in zone %s with tag %d, not zone %s tag %d", p.VNet, v.Zone, v.Tag, p.Zone, p.Tag)}
	}
	applied := false
	if created || (v != nil && v.State != "") {
		if err := a.pve.ApplySDN(ctx); err != nil {
			return nil, err
		}
		applied = true
	}
	return map[string]interface{}{"vnet": p.VNet, "created": created, "applied": applied}, nil
}

// staticAddress returns the address of a cloud-init ipconfig with a static IPv4 ("ip=10.96.0.2/24,gw=..."), or "".
func staticAddress(ipconfig string) string {
	for _, part := range strings.Split(ipconfig, ",") {
		if v, ok := strings.CutPrefix(part, "ip="); ok && v != "dhcp" {
			return strings.SplitN(v, "/", 2)[0]
		}
	}
	return ""
}

func containsString(list []string, v string) bool {
	for _, x := range list {
		if x == v {
			return true
		}
	}
	return false
}

// findByTag lists the VMs on this node that carry the tag, as vmRefs. The control plane uses
// it to find a VM whose create reply never arrived (tag "server-<id>").
func (a *Agent) findByTag(ctx context.Context, tag string) (interface{}, error) {
	vms, err := a.pve.ListVMs(ctx)
	if err != nil {
		return nil, err
	}
	refs := []string{}
	for _, vm := range vms {
		if vm.Template == 1 {
			continue
		}
		for _, t := range splitTags(vm.Tags) {
			if t == tag {
				ref := refFromTags(vm.VMID, a.cfg.Proxmox.Node, vm.Tags)
				b, _ := json.Marshal(ref)
				refs = append(refs, string(b))
				break
			}
		}
	}
	return map[string]interface{}{"vmRefs": refs}, nil
}

func (a *Agent) waitBoot(ctx context.Context, vmid int, timeout time.Duration) (interface{}, error) {
	if timeout == 0 {
		timeout = 10 * time.Minute
	}
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if err := a.pve.AgentPing(ctx, vmid); err == nil {
			res, err := a.status(ctx, vmid)
			if st, ok := res.(protocol.VmStatus); ok && err == nil {
				// The control plane compares these with the address it allocated.
				st.GuestAddresses, _ = a.guestAddresses(ctx, vmid)
				return st, nil
			}
			return res, err
		}
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-time.After(3 * time.Second):
		}
	}
	return nil, fmt.Errorf("vm %d did not finish booting within %s", vmid, timeout)
}

func (a *Agent) status(ctx context.Context, vmid int) (interface{}, error) {
	st, err := a.pve.Status(ctx, vmid)
	if err != nil {
		var apiErr *proxmox.APIError
		if errors.As(err, &apiErr) && apiErr.Status == 500 && strings.Contains(apiErr.Body, "does not exist") {
			return protocol.VmStatus{Power: "unknown"}, nil
		}
		return nil, err
	}
	return protocol.VmStatus{Power: st.Status, CpuPercent: st.CPU * 100, MemoryUsedMb: st.Mem >> 20, UptimeSec: st.Uptime}, nil
}

// guestAddresses returns the guest's addresses from the QEMU guest agent, leaving out
// loopback and link local ones.
func (a *Agent) guestAddresses(ctx context.Context, vmid int) ([]string, error) {
	ifaces, err := a.pve.GuestInterfaces(ctx, vmid)
	if err != nil {
		return nil, err
	}
	out := []string{}
	for _, ifc := range ifaces {
		for _, ip := range ifc.IPAddresses {
			parsed := net.ParseIP(ip.Address)
			if parsed == nil || parsed.IsLoopback() || parsed.IsLinkLocalUnicast() {
				continue
			}
			out = append(out, parsed.String())
		}
	}
	return out, nil
}

// cachedGuestAddresses is guestAddresses for the heartbeat, reusing a recent reading.
func (a *Agent) cachedGuestAddresses(ctx context.Context, vmid int, uptimeSec int64) []string {
	if c, ok := a.guest[vmid]; ok && time.Now().Before(c.until) {
		return c.addrs
	}
	// A guest agent that does not answer must not hold up the heartbeat.
	gctx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	addrs, err := a.guestAddresses(gctx, vmid)
	if err != nil {
		if time.Duration(uptimeSec)*time.Second >= guestBootGrace {
			a.guest[vmid] = guestAddrs{until: time.Now().Add(guestAddrsFailTTL)}
		}
		return nil
	}
	a.guest[vmid] = guestAddrs{addrs: addrs, until: time.Now().Add(guestAddrsTTL)}
	return addrs
}

// snapshotSizeGb is the space the snapshot uses on Ceph, from `rbd du` on the boot disk image.
// When that fails (no Ceph CLI, a non RBD disk) it falls back to the old estimate of the used
// memory in GB plus one, so the snapshot is still billed.
func (a *Agent) snapshotSizeGb(ctx context.Context, vmid int, snap string, log *slog.Logger) float64 {
	var cfg map[string]string
	err := errors.New("storage " + a.cfg.Proxmox.StorageType + " has no per snapshot usage")
	if a.cfg.Proxmox.StorageType != config.StorageLVMThin {
		cfg, err = a.pve.Config(ctx, vmid)
	}
	if err == nil {
		volid := strings.SplitN(cfg["scsi0"], ",", 2)[0]
		image := volid
		if i := strings.Index(volid, ":"); i >= 0 {
			image = volid[i+1:]
		}
		pool := a.cfg.Proxmox.CephPool
		if pool == "" {
			pool = a.cfg.Proxmox.Storage
		}
		var bytes int64
		if bytes, err = rbdDu(ctx, pool, image, snap); err == nil {
			return float64(bytes) / (1 << 30)
		}
	}
	log.Warn("snapshot size from rbd du failed, using the estimate", "err", err)
	st, _ := a.pve.Status(ctx, vmid)
	if st == nil {
		return 0
	}
	return float64(st.Mem>>30) + 1
}

// rbdDu returns the bytes a snapshot of an RBD image uses. Replaced in tests.
var rbdDu = func(ctx context.Context, pool, image, snap string) (int64, error) {
	if pool == "" {
		pool = "vm-disks"
	}
	out, err := exec.CommandContext(ctx, "rbd", "du", "--format", "json", "--pool", pool, image+"@"+snap).Output()
	if err != nil {
		return 0, fmt.Errorf("rbd du: %w", err)
	}
	var du struct {
		Images []struct {
			Name     string `json:"name"`
			Snapshot string `json:"snapshot"`
			UsedSize int64  `json:"used_size"`
		} `json:"images"`
		TotalUsedSize int64 `json:"total_used_size"`
	}
	if err := json.Unmarshal(out, &du); err != nil {
		return 0, fmt.Errorf("rbd du: %w", err)
	}
	for _, im := range du.Images {
		if im.Name == image && im.Snapshot == snap {
			return im.UsedSize, nil
		}
	}
	return du.TotalUsedSize, nil
}

// SetRbdDu swaps the snapshot size implementation (tests). Returns the previous one.
func SetRbdDu(f func(ctx context.Context, pool, image, snap string) (int64, error)) func(ctx context.Context, pool, image, snap string) (int64, error) {
	old := rbdDu
	rbdDu = f
	return old
}

// rbdResize grows a detached image with the Ceph CLI on the node. Replaced in tests.
var rbdResize = func(ctx context.Context, pool, image string, sizeGb int) error {
	if pool == "" {
		pool = "vm-disks"
	}
	out, err := exec.CommandContext(ctx, "rbd", "resize", "--pool", pool, "--image", image, "--size", fmt.Sprintf("%dG", sizeGb)).CombinedOutput()
	if err != nil {
		return fmt.Errorf("rbd resize: %s: %w", strings.TrimSpace(string(out)), err)
	}
	return nil
}

// lvResize grows a detached image on an LVM thin storage: `pvesm path` names the logical volume
// and lvextend grows it (lvextend refuses to shrink, like rbd resize without --allow-shrink).
// Replaced in tests.
var lvResize = func(ctx context.Context, volid string, sizeGb int) error {
	out, err := exec.CommandContext(ctx, "pvesm", "path", volid).Output()
	if err != nil {
		return fmt.Errorf("pvesm path %s: %w", volid, err)
	}
	dev := strings.TrimSpace(string(out))
	if !strings.HasPrefix(dev, "/dev/") {
		return fmt.Errorf("pvesm path %s: %q is not a block device", volid, dev)
	}
	if out, err := exec.CommandContext(ctx, "lvextend", "--size", fmt.Sprintf("%dG", sizeGb), dev).CombinedOutput(); err != nil {
		return fmt.Errorf("lvextend: %s: %w", strings.TrimSpace(string(out)), err)
	}
	return nil
}

// SetLvResize swaps the LVM thin detached resize implementation (tests). Returns the previous one.
func SetLvResize(f func(ctx context.Context, volid string, sizeGb int) error) func(ctx context.Context, volid string, sizeGb int) error {
	old := lvResize
	lvResize = f
	return old
}

// SetRbdResize swaps the detached resize implementation (tests). Returns the previous one.
func SetRbdResize(f func(ctx context.Context, pool, image string, sizeGb int) error) func(ctx context.Context, pool, image string, sizeGb int) error {
	old := rbdResize
	rbdResize = f
	return old
}

// ---- helpers ----

func parseRef(s string) (*protocol.VmRef, error) {
	var r protocol.VmRef
	if err := json.Unmarshal([]byte(s), &r); err != nil || r.VMID == 0 {
		return nil, permanent{"bad_ref", fmt.Errorf("invalid vmRef %q", s)}
	}
	return &r, nil
}

// refFromTags rebuilds a VmRef from the tags we set at create time, so heartbeats and
// usage need no control-plane lookup.
func refFromTags(vmid int, node, tags string) protocol.VmRef {
	r := protocol.VmRef{VMID: vmid, Node: node}
	for _, t := range splitTags(tags) {
		if v, ok := strings.CutPrefix(t, "server-"); ok {
			r.ServerID = v
		}
		if v, ok := strings.CutPrefix(t, "project-"); ok {
			r.ProjectID = v
		}
	}
	return r
}

// splitTags splits a Proxmox tag list. The API writes ";" but accepts "," and spaces too.
func splitTags(tags string) []string {
	return strings.FieldsFunc(tags, func(r rune) bool { return r == ';' || r == ',' || r == ' ' })
}

func toPVERules(rules []protocol.FirewallRule, action string) []proxmox.FWRule {
	out := make([]proxmox.FWRule, 0, len(rules)*2)
	for _, r := range rules {
		typ := "in"
		if r.Direction == "outbound" {
			typ = "out"
		}
		for _, cidr := range r.Cidrs {
			fr := proxmox.FWRule{Type: typ, Action: action, Proto: r.Protocol, Dport: r.Ports, Iface: r.Iface}
			if typ == "in" {
				fr.Source = cidr
			} else {
				fr.Dest = cidr
			}
			out = append(out, fr)
		}
	}
	return out
}

// firstNonEmpty returns the first argument that is not the empty string.
func firstNonEmpty(vals ...string) string {
	for _, v := range vals {
		if v != "" {
			return v
		}
	}
	return ""
}
