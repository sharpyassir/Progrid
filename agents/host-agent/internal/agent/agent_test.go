package agent_test

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	natsserver "github.com/nats-io/nats-server/v2/server"
	"github.com/nats-io/nats.go"

	"github.com/pgcloud/host-agent/internal/agent"
	"github.com/pgcloud/host-agent/internal/config"
	"github.com/pgcloud/host-agent/internal/protocol"
	"github.com/pgcloud/host-agent/internal/proxmox"
	"github.com/pgcloud/host-agent/internal/pvesim"
)

// harness runs an embedded NATS server, the Proxmox simulator and one agent, exactly
// as production wires them, so tests talk to the agent the way the control plane does.
type harness struct {
	t    *testing.T
	nc   *nats.Conn
	sim  *pvesim.Sim
	cfg  *config.Config
	subj string
}

func newHarness(t *testing.T) *harness {
	t.Helper()
	ns, err := natsserver.NewServer(&natsserver.Options{Port: -1, Host: "127.0.0.1", NoLog: true, NoSigs: true})
	if err != nil {
		t.Fatal(err)
	}
	go ns.Start()
	if !ns.ReadyForConnections(5 * time.Second) {
		t.Fatal("nats did not start")
	}
	t.Cleanup(ns.Shutdown)

	sim := pvesim.New("pve1")
	t.Cleanup(sim.Close)
	os.Setenv("PGCLOUD_SNIPPETS_DIR", t.TempDir())

	cfg := &config.Config{
		HostID: "host_test", NATSURL: ns.ClientURL(), Heartbeat: 300 * time.Millisecond,
		Proxmox: config.Proxmox{URL: sim.URL(), Node: "pve1", TokenID: sim.TokenID, TokenSecret: sim.TokenSecret, Storage: sim.Storage, Bridge: "customers", PublicBridge: "vmbr0"},
	}
	log := slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelWarn}))
	a, err := agent.New(cfg, proxmox.New(cfg.Proxmox, log), "test", log)
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)
	go func() { _ = a.Run(ctx) }()

	nc, err := nats.Connect(ns.ClientURL())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(nc.Close)
	old := agent.SetRbdDu(sim.RbdDu)
	t.Cleanup(func() { agent.SetRbdDu(old) })
	h := &harness{t: t, nc: nc, sim: sim, cfg: cfg, subj: "pgcloud.host.host_test.jobs"}
	// Wait until the agent's subscription is live.
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		if _, err := nc.Request(h.subj, []byte(`{"id":"warmup","kind":"vm.status","params":{"vmRef":"{\"vmid\":1,\"node\":\"pve1\"}"}}`), 300*time.Millisecond); err == nil {
			return h
		}
	}
	t.Fatal("agent did not subscribe")
	return nil
}

// job sends one job like the control plane does and returns the parsed result.
func (h *harness) job(kind string, params interface{}) protocol.JobResult {
	h.t.Helper()
	return h.jobID("job_"+kind+"_"+time.Now().Format("150405.000000"), kind, params)
}

func (h *harness) jobID(id, kind string, params interface{}) protocol.JobResult {
	h.t.Helper()
	p, _ := json.Marshal(params)
	body, _ := json.Marshal(protocol.Job{ID: id, Kind: kind, Params: p, IssuedAt: time.Now().Format(time.RFC3339)})
	msg, err := h.nc.Request(h.subj, body, 15*time.Second)
	if err != nil {
		h.t.Fatalf("%s: no reply: %v", kind, err)
	}
	var r protocol.JobResult
	if err := json.Unmarshal(msg.Data, &r); err != nil {
		h.t.Fatalf("%s: bad reply %s", kind, msg.Data)
	}
	return r
}

func (h *harness) mustOK(r protocol.JobResult) protocol.JobResult {
	h.t.Helper()
	if !r.OK {
		h.t.Fatalf("job failed: %+v", r.Error)
	}
	return r
}

func spec(serverID string) protocol.VmSpec {
	return protocol.VmSpec{
		ServerID: serverID, Name: "web-1", Hostname: "web-1", Vcpu: 2, MemoryMb: 4096, DiskGb: 80,
		ImageRef: `{"template":9000}`, SshKeys: []string{"ssh-ed25519 AAAA test"}, UserData: "#cloud-config\nhostname: web-1\n",
		NetworkRef: "vpc-proj_1", PublicIP: &protocol.PublicIP{Address: "203.0.113.10", Gateway: "203.0.113.1", Prefix: 24},
		PrivateIP: &protocol.PrivateIP{Address: "10.96.0.2", Prefix: 24},
	}
}

func vmidOf(t *testing.T, r protocol.JobResult) (int, string) {
	t.Helper()
	b, _ := json.Marshal(r.Result)
	var h protocol.VmHandle
	_ = json.Unmarshal(b, &h)
	var ref protocol.VmRef
	if err := json.Unmarshal([]byte(h.VmRef), &ref); err != nil || ref.VMID == 0 {
		t.Fatalf("bad vmRef in result: %s", b)
	}
	return ref.VMID, h.VmRef
}

func TestCreateConfiguresCloneAndBoots(t *testing.T) {
	h := newHarness(t)
	r := h.mustOK(h.job(protocol.JobCreate, map[string]interface{}{"spec": spec("srv_1")}))
	vmid, ref := vmidOf(t, r)

	vm := h.sim.VM(vmid)
	if vm == nil {
		t.Fatal("vm not created in simulator")
	}
	if vm.Status != "running" || vm.Cores != 2 || vm.MemoryMb != 4096 || vm.DiskGb != 80 {
		t.Fatalf("vm state wrong: %+v", vm)
	}
	if !strings.Contains(vm.Tags, "server-srv_1") || !strings.Contains(vm.Tags, "project-proj_1") {
		t.Fatalf("tags not set for attribution: %q", vm.Tags)
	}
	if !strings.HasPrefix(vm.Config["net1"], "virtio=BC:24:11:") || !strings.HasSuffix(vm.Config["net1"], ",bridge=vmbr0,firewall=1") || !strings.HasPrefix(vm.Config["ipconfig1"], "ip=203.0.113.10/24,gw=203.0.113.1") {
		t.Fatalf("public network not configured: %v", vm.Config)
	}
	if vm.Config["ipconfig0"] != "ip=10.96.0.2/24" || !strings.HasSuffix(vm.Config["net0"], ",bridge=customers,firewall=1") {
		t.Fatalf("private NIC not static without a gateway: %v", vm.Config)
	}
	if h := handleOf(t, r); h.PrivateIP != "10.96.0.2" {
		t.Fatalf("create result lacks the private address: %+v", h)
	}
	if !strings.HasPrefix(vm.Config["cicustom"], "user=local:snippets/pgcloud-") {
		t.Fatalf("cloud-init snippet not referenced: %v", vm.Config)
	}
	if b, err := os.ReadFile(filepath.Join(os.Getenv("PGCLOUD_SNIPPETS_DIR"), "pgcloud-"+itoa(vmid)+"-user.yaml")); err != nil || !strings.Contains(string(b), "hostname: web-1") {
		t.Fatalf("user-data snippet not written: %v", err)
	} else if !strings.Contains(string(b), "ssh-ed25519 AAAA test") || !strings.Contains(string(b), "fqdn: web-1") {
		t.Fatalf("user-data snippet lacks the SSH key or hostname: %s", b)
	}
	if k := vm.Config["sshkeys"]; k != "ssh-ed25519%20AAAA%20test" {
		t.Fatalf("sshkeys not encoded with %%20: %q", k)
	}

	// wait_boot answers once the guest agent pings, which the simulator delays after start.
	r = h.mustOK(h.job(protocol.JobWaitBoot, map[string]interface{}{"vmRef": ref, "timeoutMs": 5000}))
	b, _ := json.Marshal(r.Result)
	var st protocol.VmStatus
	_ = json.Unmarshal(b, &st)
	if st.Power != "running" {
		t.Fatalf("expected running after boot, got %+v", st)
	}
}

// A control plane that sends no private address keeps the old DHCP behavior on net0.
func TestCreateWithoutPrivateIPUsesDHCP(t *testing.T) {
	h := newHarness(t)
	sp := spec("srv_dhcp")
	sp.PrivateIP = nil
	vmid, _ := vmidOf(t, h.mustOK(h.job(protocol.JobCreate, map[string]interface{}{"spec": sp})))
	if got := h.sim.VM(vmid).Config["ipconfig0"]; got != "ip=dhcp" {
		t.Fatalf("expected DHCP on net0, got %q", got)
	}
}

func handleOf(t *testing.T, r protocol.JobResult) protocol.VmHandle {
	t.Helper()
	b, _ := json.Marshal(r.Result)
	var h protocol.VmHandle
	if err := json.Unmarshal(b, &h); err != nil {
		t.Fatalf("bad create result %s", b)
	}
	return h
}

func TestPowerSnapshotFirewallResizeDelete(t *testing.T) {
	h := newHarness(t)
	r := h.mustOK(h.job(protocol.JobCreate, map[string]interface{}{"spec": spec("srv_2")}))
	vmid, ref := vmidOf(t, r)

	h.mustOK(h.job(protocol.JobStop, map[string]interface{}{"vmRef": ref}))
	if h.sim.VM(vmid).Status != "stopped" {
		t.Fatal("stop did not stop")
	}
	h.mustOK(h.job(protocol.JobStart, map[string]interface{}{"vmRef": ref}))
	if h.sim.VM(vmid).Status != "running" {
		t.Fatal("start did not start")
	}
	h.mustOK(h.job(protocol.JobReboot, map[string]interface{}{"vmRef": ref}))

	r = h.mustOK(h.job(protocol.JobSnapshot, map[string]interface{}{"vmRef": ref, "snapshotId": "SNAP1"}))
	res := r.Result.(map[string]interface{})
	if !strings.Contains(res["snapshotRef"].(string), `"name":"pgsnap1"`) || len(h.sim.VM(vmid).Snaps) != 1 {
		t.Fatalf("snapshot not taken: %v / %v", res, h.sim.VM(vmid).Snaps)
	}
	if res["sizeGb"] != float64(pvesim.SnapshotBytes)/(1<<30) {
		t.Fatalf("snapshot size not read from rbd du: %v", res["sizeGb"])
	}
	// Without the Ceph CLI the size falls back to the estimate (used memory in GB plus one).
	old := agent.SetRbdDu(func(context.Context, string, string, string) (int64, error) { return 0, errors.New("rbd: not found") })
	r = h.mustOK(h.job(protocol.JobSnapshot, map[string]interface{}{"vmRef": ref, "snapshotId": "SNAP2"}))
	agent.SetRbdDu(old)
	if got := r.Result.(map[string]interface{})["sizeGb"]; got != float64(3) {
		t.Fatalf("fallback size wrong: %v", got)
	}
	h.mustOK(h.job(protocol.JobSnapshotDel, map[string]interface{}{"snapshotRef": r.Result.(map[string]interface{})["snapshotRef"]}))
	h.mustOK(h.job(protocol.JobSnapshotDel, map[string]interface{}{"snapshotRef": res["snapshotRef"]}))
	if len(h.sim.VM(vmid).Snaps) != 0 {
		t.Fatal("snapshot not deleted")
	}

	rules := []protocol.FirewallRule{
		{Direction: "inbound", Protocol: "tcp", Ports: "22", Cidrs: []string{"203.0.113.0/24"}},
		{Direction: "inbound", Protocol: "tcp", Ports: "80-443", Cidrs: []string{"0.0.0.0/0", "::/0"}},
		{Direction: "outbound", Protocol: "any", Cidrs: []string{"0.0.0.0/0"}},
	}
	h.mustOK(h.job(protocol.JobApplyFirewall, map[string]interface{}{"vmRef": ref, "rules": rules}))
	vm := h.sim.VM(vmid)
	if vm.FWOpts["enable"] != "1" || vm.FWOpts["policy_in"] != "DROP" || len(vm.FWRules) != 4 {
		t.Fatalf("firewall not applied: opts=%v rules=%v", vm.FWOpts, vm.FWRules)
	}
	if vm.FWRules[1]["dport"] != "80:443" {
		t.Fatalf("port range not translated for Proxmox: %v", vm.FWRules[1])
	}
	// Applying again replaces instead of appending.
	h.mustOK(h.job(protocol.JobApplyFirewall, map[string]interface{}{"vmRef": ref, "rules": rules[:1]}))
	if len(h.sim.VM(vmid).FWRules) != 1 {
		t.Fatalf("firewall rules not replaced: %v", h.sim.VM(vmid).FWRules)
	}

	h.mustOK(h.job(protocol.JobResize, map[string]interface{}{"vmRef": ref, "vcpu": 4, "memoryMb": 8192, "diskGb": 160}))
	vm = h.sim.VM(vmid)
	if vm.Cores != 4 || vm.MemoryMb != 8192 || vm.DiskGb != 160 {
		t.Fatalf("resize not applied: %+v", vm)
	}
	// Proxmox refuses to shrink a disk with a 500; the agent surfaces it as proxmox_500 with the text.
	r = h.job(protocol.JobResize, map[string]interface{}{"vmRef": ref, "vcpu": 4, "memoryMb": 8192, "diskGb": 40})
	if r.OK || r.Error.Code != "proxmox_500" || !strings.Contains(r.Error.Message, "shrinking") {
		t.Fatalf("shrinking the disk must fail with the Proxmox message: %+v", r)
	}

	h.mustOK(h.job(protocol.JobDelete, map[string]interface{}{"vmRef": ref}))
	if h.sim.VM(vmid) != nil {
		t.Fatal("vm not deleted")
	}
	// Deleting again is idempotent, and status of a gone VM is "unknown", not an error.
	h.mustOK(h.job(protocol.JobDelete, map[string]interface{}{"vmRef": ref}))
	r = h.mustOK(h.job(protocol.JobStatus, map[string]interface{}{"vmRef": ref}))
	if !strings.Contains(string(mustJSON(r.Result)), `"power":"unknown"`) {
		t.Fatalf("status of deleted vm: %v", r.Result)
	}
}

func TestResizeKeepsNameTagsAndMAC(t *testing.T) {
	h := newHarness(t)
	vmid, ref := vmidOf(t, h.mustOK(h.job(protocol.JobCreate, map[string]interface{}{"spec": spec("srv_rs")})))
	before := h.sim.VM(vmid)
	h.mustOK(h.job(protocol.JobResize, map[string]interface{}{"vmRef": ref, "vcpu": 4, "memoryMb": 8192, "diskGb": 160}))
	after := h.sim.VM(vmid)
	if after.Cores != 4 || after.MemoryMb != 8192 || after.DiskGb != 160 {
		t.Fatalf("resize not applied: %+v", after)
	}
	if after.Name != before.Name || after.Tags != before.Tags {
		t.Fatalf("resize changed name or tags: %q %q, was %q %q", after.Name, after.Tags, before.Name, before.Tags)
	}
	for _, k := range []string{"net0", "net1", "ipconfig0", "ipconfig1", "sshkeys", "cicustom"} {
		if after.Config[k] != before.Config[k] {
			t.Fatalf("resize changed %s: %q, was %q", k, after.Config[k], before.Config[k])
		}
	}
}

// Rebuild deletes the VM and clones a new one; volumes live on and plug into the new VM.
func TestVolumeSurvivesRebuild(t *testing.T) {
	h := newHarness(t)
	_, ref := vmidOf(t, h.mustOK(h.job(protocol.JobCreate, map[string]interface{}{"spec": spec("srv_rb")})))
	volRef := h.mustOK(h.job(protocol.JobVolumeCreate, map[string]interface{}{"volumeId": "VOLRB", "sizeGb": 50})).Result.(map[string]interface{})["volumeRef"].(string)
	h.mustOK(h.job(protocol.JobVolumeAttach, map[string]interface{}{"vmRef": ref, "volumeRef": volRef, "serial": "volrb"}))

	h.mustOK(h.job(protocol.JobDelete, map[string]interface{}{"vmRef": ref}))
	if h.sim.Volumes["vm-900000-vol-volrb"] != 50 {
		t.Fatalf("deleting the VM destroyed the volume: %v", h.sim.Volumes)
	}
	newID, newRef := vmidOf(t, h.mustOK(h.job(protocol.JobCreate, map[string]interface{}{"spec": spec("srv_rb")})))
	r := h.mustOK(h.job(protocol.JobVolumeAttach, map[string]interface{}{"vmRef": newRef, "volumeRef": volRef, "serial": "volrb"}))
	if r.Result.(map[string]interface{})["device"] != "/dev/disk/by-id/scsi-0QEMU_QEMU_HARDDISK_volrb" {
		t.Fatalf("reattach result wrong: %v", r.Result)
	}
	if cfg := h.sim.VM(newID).Config["scsi1"]; !strings.Contains(cfg, "vm-900000-vol-volrb") {
		t.Fatalf("volume not attached to the rebuilt VM: %q", cfg)
	}
}

func TestRollbackAndCreateFromSnapshot(t *testing.T) {
	h := newHarness(t)
	vmid, ref := vmidOf(t, h.mustOK(h.job(protocol.JobCreate, map[string]interface{}{"spec": spec("srv_snap")})))
	snapRef := h.mustOK(h.job(protocol.JobSnapshot, map[string]interface{}{"vmRef": ref, "snapshotId": "S1"})).Result.(map[string]interface{})["snapshotRef"].(string)

	// Restore: the control plane stops the VM, rolls back, and starts it again.
	h.mustOK(h.job(protocol.JobStop, map[string]interface{}{"vmRef": ref, "force": true}))
	h.mustOK(h.job(protocol.JobRollback, map[string]interface{}{"vmRef": ref, "snapshotRef": snapRef}))
	if h.sim.VM(vmid).RolledBackTo != "pgs1" {
		t.Fatalf("rollback not done: %+v", h.sim.VM(vmid))
	}
	h.mustOK(h.job(protocol.JobStart, map[string]interface{}{"vmRef": ref}))

	// A snapshot of another VM is refused before Proxmox is called.
	r := h.job(protocol.JobRollback, map[string]interface{}{"vmRef": `{"vmid":999,"node":"pve1"}`, "snapshotRef": snapRef})
	if r.OK || r.Error.Code != "bad_ref" || r.Error.Retryable {
		t.Fatalf("expected bad_ref for a foreign snapshot, got %+v", r)
	}
	// A snapshot that does not exist is a Proxmox error.
	r = h.job(protocol.JobRollback, map[string]interface{}{"vmRef": ref, "snapshotRef": strings.Replace(snapRef, "pgs1", "pgnope", 1)})
	if r.OK || !strings.Contains(r.Error.Message, "does not exist") {
		t.Fatalf("expected a missing snapshot error, got %+v", r)
	}

	// Create from the snapshot: a full clone of the source VM at that snapshot.
	sp := spec("srv_from_snap")
	sp.ImageRef = snapRef
	newID, _ := vmidOf(t, h.mustOK(h.job(protocol.JobCreate, map[string]interface{}{"spec": sp})))
	if src := h.sim.VM(newID).Source; src != itoa(vmid)+"@pgs1" {
		t.Fatalf("new vm cloned from %q, want %d@pgs1", src, vmid)
	}
	if !strings.Contains(h.sim.VM(newID).Tags, "server-srv_from_snap") {
		t.Fatalf("clone from snapshot not configured: %+v", h.sim.VM(newID))
	}
	// A snapshot on another node cannot be cloned here.
	sp.ImageRef = strings.Replace(snapRef, `"node":"pve1"`, `"node":"pve9"`, 1)
	if r := h.job(protocol.JobCreate, map[string]interface{}{"spec": sp}); r.OK || r.Error.Code != "wrong_node" {
		t.Fatalf("expected wrong_node, got %+v", r)
	}
}

// A floating IP moves from one server to another: detach from the first, attach to the second.
func TestFloatingIPMoves(t *testing.T) {
	h := newHarness(t)
	idA, refA := vmidOf(t, h.mustOK(h.job(protocol.JobCreate, map[string]interface{}{"spec": spec("srv_fa")})))
	sb := spec("srv_fb")
	sb.PublicIP = nil
	idB, refB := vmidOf(t, h.mustOK(h.job(protocol.JobCreate, map[string]interface{}{"spec": sb})))
	if _, has := h.sim.VM(idB).Config["net1"]; has {
		t.Fatal("server B should start without a public NIC")
	}

	// Detaching an address the VM does not carry changes nothing.
	h.mustOK(h.job(protocol.JobDetachIP, map[string]interface{}{"vmRef": refA, "address": "198.51.100.7"}))
	if h.sim.VM(idA).Config["net1"] == "" {
		t.Fatal("detach of another address removed the NIC")
	}
	h.mustOK(h.job(protocol.JobDetachIP, map[string]interface{}{"vmRef": refA, "address": "203.0.113.10"}))
	a := h.sim.VM(idA)
	if _, has := a.Config["net1"]; has || a.Config["ipconfig1"] != "" || a.CloudInitRegens != 1 {
		t.Fatalf("address not removed from A: %v (regens %d)", a.Config, a.CloudInitRegens)
	}

	ip := protocol.PublicIP{Address: "203.0.113.10", Gateway: "203.0.113.1", Prefix: 24}
	h.mustOK(h.job(protocol.JobAttachIP, map[string]interface{}{"vmRef": refB, "ip": ip}))
	b := h.sim.VM(idB)
	if !strings.HasPrefix(b.Config["net1"], "virtio=") || !strings.HasSuffix(b.Config["net1"], ",bridge=vmbr0,firewall=1") || b.Config["ipconfig1"] != "ip=203.0.113.10/24,gw=203.0.113.1" || b.CloudInitRegens != 1 {
		t.Fatalf("address not configured on B: %v (regens %d)", b.Config, b.CloudInitRegens)
	}
	// Attaching again keeps the NIC's MAC.
	mac := strings.SplitN(b.Config["net1"], ",", 2)[0]
	h.mustOK(h.job(protocol.JobAttachIP, map[string]interface{}{"vmRef": refB, "ip": ip}))
	if got := strings.SplitN(h.sim.VM(idB).Config["net1"], ",", 2)[0]; got != mac {
		t.Fatalf("reattach changed the MAC: %s, was %s", got, mac)
	}
	// And back to A, which gets a NIC again.
	h.mustOK(h.job(protocol.JobDetachIP, map[string]interface{}{"vmRef": refB, "address": "203.0.113.10"}))
	h.mustOK(h.job(protocol.JobAttachIP, map[string]interface{}{"vmRef": refA, "ip": ip}))
	if h.sim.VM(idA).Config["ipconfig1"] != "ip=203.0.113.10/24,gw=203.0.113.1" || h.sim.VM(idB).Config["ipconfig1"] != "" {
		t.Fatalf("address did not move back: A %v, B %v", h.sim.VM(idA).Config, h.sim.VM(idB).Config)
	}
}

func TestErrorsAreClassified(t *testing.T) {
	h := newHarness(t)

	// A failed Proxmox task is retryable; the half made VM is cleaned up.
	h.sim.FailNext("start", 1)
	r := h.job(protocol.JobCreate, map[string]interface{}{"spec": spec("srv_3")})
	if r.OK || !r.Error.Retryable || r.Error.Code != "job_failed" {
		t.Fatalf("expected retryable job_failed, got %+v", r)
	}
	for _, vm := range []int{100, 101, 102} {
		if v := h.sim.VM(vm); v != nil && !v.Template && v.Name == "web-1" {
			t.Fatalf("failed create left vm %d behind", vm)
		}
	}

	// A 500 from a config call is a permanent proxmox_500.
	h.sim.FailNext("config", 1)
	r = h.job(protocol.JobCreate, map[string]interface{}{"spec": spec("srv_4")})
	if r.OK || r.Error.Code != "proxmox_500" || !r.Error.Retryable {
		t.Fatalf("expected proxmox_500 retryable, got %+v", r)
	}

	// Bad references and unknown kinds never retry.
	r = h.job(protocol.JobStart, map[string]interface{}{"vmRef": "not json"})
	if r.OK || r.Error.Code != "bad_ref" || r.Error.Retryable {
		t.Fatalf("expected bad_ref, got %+v", r)
	}
	r = h.job("vm.teleport", map[string]interface{}{})
	if r.OK || r.Error.Code != "unknown_job" || r.Error.Retryable {
		t.Fatalf("expected unknown_job, got %+v", r)
	}
	r = h.job(protocol.JobCreate, map[string]interface{}{"spec": protocol.VmSpec{ImageRef: "ubuntu"}})
	if r.OK || r.Error.Code != "bad_image_ref" {
		t.Fatalf("expected bad_image_ref, got %+v", r)
	}
	r = h.job(protocol.JobAttachIP, map[string]interface{}{"vmRef": `{"vmid":9000,"node":"pve1"}`})
	if r.OK || r.Error.Code != "bad_params" || r.Error.Retryable {
		t.Fatalf("expected bad_params, got %+v", r)
	}
}

func TestRepeatedJobIDReturnsStoredResult(t *testing.T) {
	h := newHarness(t)
	// Two requests with the same id while the clone runs: one VM, both get the same answer.
	type reply struct {
		r   protocol.JobResult
		err error
	}
	p, _ := json.Marshal(map[string]interface{}{"spec": spec("srv_5")})
	body, _ := json.Marshal(protocol.Job{ID: "vm.create:srv_5", Kind: protocol.JobCreate, Params: p})
	replies := make(chan reply, 2)
	for i := 0; i < 2; i++ {
		go func() {
			msg, err := h.nc.Request(h.subj, body, 15*time.Second)
			var r protocol.JobResult
			if err == nil {
				err = json.Unmarshal(msg.Data, &r)
			}
			replies <- reply{r, err}
		}()
	}
	var refs []string
	for i := 0; i < 2; i++ {
		rp := <-replies
		if rp.err != nil {
			t.Fatalf("no reply: %v", rp.err)
		}
		_, ref := vmidOf(t, h.mustOK(rp.r))
		refs = append(refs, ref)
	}
	if refs[0] != refs[1] {
		t.Fatalf("repeated id got different VMs: %v", refs)
	}
	clones := 0
	for _, c := range h.sim.Calls() {
		if strings.HasSuffix(c, "/clone") {
			clones++
		}
	}
	if clones != 1 {
		t.Fatalf("expected one clone, got %d", clones)
	}

	// A retry after completion gets the stored result, not a second VM.
	r := h.mustOK(h.jobID("vm.create:srv_5", protocol.JobCreate, map[string]interface{}{"spec": spec("srv_5")}))
	if _, ref := vmidOf(t, r); ref != refs[0] {
		t.Fatalf("retry after completion returned %s, want %s", ref, refs[0])
	}

	// A failed job is not stored: a retry with the same id runs again and succeeds.
	h.sim.FailNext("clone", 1)
	if r := h.jobID("vm.create:srv_5b", protocol.JobCreate, map[string]interface{}{"spec": spec("srv_5b")}); r.OK {
		t.Fatal("expected the injected clone failure")
	}
	h.mustOK(h.jobID("vm.create:srv_5b", protocol.JobCreate, map[string]interface{}{"spec": spec("srv_5b")}))
}

func TestFindByTag(t *testing.T) {
	h := newHarness(t)
	_, ref := vmidOf(t, h.mustOK(h.job(protocol.JobCreate, map[string]interface{}{"spec": spec("srv_orphan")})))
	h.mustOK(h.job(protocol.JobCreate, map[string]interface{}{"spec": spec("srv_other")}))

	r := h.mustOK(h.job(protocol.JobFindByTag, map[string]interface{}{"tag": "server-srv_orphan"}))
	refs := r.Result.(map[string]interface{})["vmRefs"].([]interface{})
	if len(refs) != 1 || refs[0] != ref {
		t.Fatalf("find_by_tag returned %v, want [%s]", refs, ref)
	}
	r = h.mustOK(h.job(protocol.JobFindByTag, map[string]interface{}{"tag": "server-nothing"}))
	if refs := r.Result.(map[string]interface{})["vmRefs"].([]interface{}); len(refs) != 0 {
		t.Fatalf("expected no match, got %v", refs)
	}
	if r := h.job(protocol.JobFindByTag, map[string]interface{}{}); r.OK || r.Error.Code != "bad_params" {
		t.Fatalf("expected bad_params, got %+v", r)
	}
}

// The guest agent's view of the network reaches the control plane after boot and in heartbeats.
func TestGuestAddressesAfterBootAndInHeartbeat(t *testing.T) {
	h := newHarness(t)
	hb := make(chan *nats.Msg, 256)
	sub, _ := h.nc.ChanSubscribe("pgcloud.host.host_test.heartbeat", hb)
	defer sub.Unsubscribe()

	vmid, ref := vmidOf(t, h.mustOK(h.job(protocol.JobCreate, map[string]interface{}{"spec": spec("srv_ga")})))
	r := h.mustOK(h.job(protocol.JobWaitBoot, map[string]interface{}{"vmRef": ref, "timeoutMs": 5000}))
	b, _ := json.Marshal(r.Result)
	var st protocol.VmStatus
	_ = json.Unmarshal(b, &st)
	if strings.Join(st.GuestAddresses, ",") != "10.96.0.2,203.0.113.10" {
		t.Fatalf("wait_boot guest addresses wrong (loopback and link local must be left out): %v", st.GuestAddresses)
	}

	deadline := time.After(3 * time.Second)
	for {
		select {
		case m := <-hb:
			var got protocol.Heartbeat
			_ = json.Unmarshal(m.Data, &got)
			for _, v := range got.Vms {
				if v.ServerID == "srv_ga" && strings.Join(v.Addresses, ",") == "10.96.0.2,203.0.113.10" {
					goto seen
				}
			}
		case <-deadline:
			t.Fatal("no heartbeat with the guest addresses of srv_ga")
		}
	}
seen:
	// A guest that changed its own address shows it on the next wait_boot; the control plane
	// compares and warns.
	h.sim.SetGuestAddresses(vmid, []string{"10.96.0.77"})
	r = h.mustOK(h.job(protocol.JobWaitBoot, map[string]interface{}{"vmRef": ref, "timeoutMs": 5000}))
	b, _ = json.Marshal(r.Result)
	_ = json.Unmarshal(b, &st)
	if len(st.GuestAddresses) != 1 || st.GuestAddresses[0] != "10.96.0.77" {
		t.Fatalf("expected the guest's own address, got %v", st.GuestAddresses)
	}
	// Without an answering guest agent the boot result simply carries no addresses.
	h.sim.FailNext("guest", 1)
	r = h.mustOK(h.job(protocol.JobWaitBoot, map[string]interface{}{"vmRef": ref, "timeoutMs": 5000}))
	if b, _ := json.Marshal(r.Result); strings.Contains(string(b), "guestAddresses") {
		t.Fatalf("expected no addresses when the guest agent fails: %s", b)
	}
}

func TestHeartbeatAndUsage(t *testing.T) {
	h := newHarness(t)
	hb := make(chan *nats.Msg, 256)
	usage := make(chan *nats.Msg, 1024)
	metrics := make(chan *nats.Msg, 1024)
	sub1, _ := h.nc.ChanSubscribe("pgcloud.host.host_test.heartbeat", hb)
	sub2, _ := h.nc.ChanSubscribe("pgcloud.usage", usage)
	sub3, _ := h.nc.ChanSubscribe("pgcloud.metrics", metrics)
	defer sub1.Unsubscribe()
	defer sub2.Unsubscribe()
	defer sub3.Unsubscribe()

	h.mustOK(h.job(protocol.JobCreate, map[string]interface{}{"spec": spec("srv_6")}))

	// Heartbeats tick every 300ms; wait for one taken after the create finished, when the
	// VM carries its attribution tags.
	deadline := time.After(3 * time.Second)
	var got protocol.Heartbeat
	for {
		select {
		case m := <-hb:
			_ = json.Unmarshal(m.Data, &got)
			if len(got.Vms) >= 1 && strings.Contains(got.Vms[0].VmRef, `"serverId":"srv_6"`) {
				goto haveHeartbeat
			}
		case <-deadline:
			t.Fatalf("no heartbeat listing the attributed vm, last: %+v", got)
		}
	}
haveHeartbeat:
	if got.HostID != "host_test" || got.Node != "pve1" || got.TotalVcpu != 64 || got.TotalMemoryMb != 256<<10 || got.UsedVcpu < 2 {
		t.Fatalf("heartbeat wrong: %+v", got)
	}
	if !strings.Contains(got.Vms[0].VmRef, `"serverId":"srv_6"`) {
		t.Fatalf("heartbeat vm not attributed: %+v", got.Vms)
	}
	// Templates are never reported as customer VMs.
	for _, v := range got.Vms {
		if strings.Contains(v.VmRef, `"vmid":9000`) {
			t.Fatal("template reported as a vm")
		}
	}

	// Usage: one server minute per tick for srv_6, attributed to its project, plus bandwidth.
	udeadline := time.After(3 * time.Second)
	for done := false; !done; {
		select {
		case m := <-usage:
			var u protocol.UsageEvent
			_ = json.Unmarshal(m.Data, &u)
			if u.ResourceType == "server" && u.ResourceID == "srv_6" {
				if u.V != 1 || u.ProjectID != "proj_1" || u.Unit != "minute" || u.Quantity != 1 || u.HostID != "host_test" {
					t.Fatalf("usage event wrong: %+v", u)
				}
				done = true
			}
		case <-udeadline:
			t.Fatal("no usage event for srv_6")
		}
	}
	// Metrics: raw counters per VM per tick, for graphs and alerts.
	mdeadline := time.After(3 * time.Second)
	for {
		select {
		case m := <-metrics:
			var s protocol.MetricSample
			_ = json.Unmarshal(m.Data, &s)
			if s.ServerID == "srv_6" {
				if s.V != 1 || s.MemoryTotalMb != 4096 || s.MemoryUsedMb != 2048 || s.NetOutBytes != 2000 || s.DiskWriteBytes != 8192 || s.Power != "running" {
					t.Fatalf("metric sample wrong: %+v", s)
				}
				return
			}
		case <-mdeadline:
			t.Fatal("no metric sample for srv_6")
		}
	}
}

func TestBandwidthIsSentAsDelta(t *testing.T) {
	h := newHarness(t)
	hb := make(chan *nats.Msg, 256)
	usage := make(chan *nats.Msg, 1024)
	sub1, _ := h.nc.ChanSubscribe("pgcloud.host.host_test.heartbeat", hb)
	sub2, _ := h.nc.ChanSubscribe("pgcloud.usage", usage)
	defer sub1.Unsubscribe()
	defer sub2.Unsubscribe()

	vmid, _ := vmidOf(t, h.mustOK(h.job(protocol.JobCreate, map[string]interface{}{"spec": spec("srv_bw")})))
	// Wait for a heartbeat that lists the VM: the agent has its baseline counter then.
	deadline := time.After(3 * time.Second)
	for listed := false; !listed; {
		select {
		case m := <-hb:
			listed = strings.Contains(string(m.Data), `\"serverId\":\"srv_bw\"`)
		case <-deadline:
			t.Fatal("no heartbeat listing the vm")
		}
	}
	// The baseline reading itself is never billed.
	drain := func() {
		for {
			select {
			case m := <-usage:
				var u protocol.UsageEvent
				_ = json.Unmarshal(m.Data, &u)
				if u.ResourceType == "bandwidth" && u.ResourceID == "srv_bw" {
					t.Fatalf("baseline billed as bandwidth: %+v", u)
				}
			default:
				return
			}
		}
	}
	drain()

	next := func() protocol.UsageEvent {
		t.Helper()
		deadline := time.After(3 * time.Second)
		for {
			select {
			case m := <-usage:
				var u protocol.UsageEvent
				_ = json.Unmarshal(m.Data, &u)
				if u.ResourceType == "bandwidth" && u.ResourceID == "srv_bw" {
					return u
				}
			case <-deadline:
				t.Fatal("no bandwidth event")
			}
		}
	}
	h.sim.SetNetOut(vmid, 5000)
	if u := next(); u.Quantity != 3000 || u.Unit != "byte" || u.ProjectID != "proj_1" {
		t.Fatalf("expected a 3000 byte delta, got %+v", u)
	}
	// A smaller counter means the VM rebooted: the new value is all new traffic.
	h.sim.SetNetOut(vmid, 700)
	if u := next(); u.Quantity != 700 {
		t.Fatalf("expected 700 bytes after the reboot, got %+v", u)
	}
	h.sim.SetNetOut(vmid, 1700)
	if u := next(); u.Quantity != 1000 {
		t.Fatalf("expected a 1000 byte delta, got %+v", u)
	}
}

func TestVolumeLifecycle(t *testing.T) {
	h := newHarness(t)
	r := h.mustOK(h.job(protocol.JobCreate, map[string]interface{}{"spec": spec("srv_7")}))
	vmid, vmRef := vmidOf(t, r)

	r = h.mustOK(h.job(protocol.JobVolumeCreate, map[string]interface{}{"volumeId": "VOL1", "sizeGb": 100}))
	volRef := r.Result.(map[string]interface{})["volumeRef"].(string)
	if !strings.Contains(volRef, `"volume":"vm-900000-vol-vol1"`) {
		t.Fatalf("unexpected volumeRef %s", volRef)
	}
	if h.sim.Volumes["vm-900000-vol-vol1"] != 100 {
		t.Fatalf("image not allocated: %v", h.sim.Volumes)
	}

	r = h.mustOK(h.job(protocol.JobVolumeAttach, map[string]interface{}{"vmRef": vmRef, "volumeRef": volRef, "serial": "vol1serial"}))
	res := r.Result.(map[string]interface{})
	if res["slot"] != "scsi1" || res["device"] != "/dev/disk/by-id/scsi-0QEMU_QEMU_HARDDISK_vol1serial" {
		t.Fatalf("attach result wrong: %v", res)
	}
	if cfg := h.sim.VM(vmid).Config["scsi1"]; !strings.Contains(cfg, "vm-900000-vol-vol1") || !strings.Contains(cfg, "serial=vol1serial") || !strings.Contains(cfg, "backup=0") {
		t.Fatalf("disk not plugged: %q", cfg)
	}
	// Attaching again is idempotent and keeps the slot.
	r = h.mustOK(h.job(protocol.JobVolumeAttach, map[string]interface{}{"vmRef": vmRef, "volumeRef": volRef, "serial": "vol1serial"}))
	if r.Result.(map[string]interface{})["slot"] != "scsi1" {
		t.Fatal("second attach moved the disk")
	}

	// Grow while attached goes through the VM resize call.
	h.mustOK(h.job(protocol.JobVolumeResize, map[string]interface{}{"vmRef": vmRef, "volumeRef": volRef, "sizeGb": 250}))
	if h.sim.Volumes["vm-900000-vol-vol1"] != 250 {
		t.Fatalf("attached resize not applied: %v", h.sim.Volumes)
	}
	// Proxmox refuses to free an attached image; the agent reports the error.
	r = h.job(protocol.JobVolumeDelete, map[string]interface{}{"volumeRef": volRef})
	if r.OK || !strings.Contains(r.Error.Message, "still attached") {
		t.Fatalf("delete of attached volume must fail: %+v", r)
	}

	h.mustOK(h.job(protocol.JobVolumeDetach, map[string]interface{}{"vmRef": vmRef, "volumeRef": volRef}))
	if _, still := h.sim.VM(vmid).Config["scsi1"]; still {
		t.Fatal("disk not unplugged")
	}
	h.mustOK(h.job(protocol.JobVolumeDetach, map[string]interface{}{"vmRef": vmRef, "volumeRef": volRef})) // idempotent

	// Detached resize uses the rbd tool; stub it here.
	called := ""
	old := agent.SetRbdResize(func(_ context.Context, pool, image string, sizeGb int) error {
		called = pool + "/" + image + "=" + itoa(sizeGb)
		return nil
	})
	defer agent.SetRbdResize(old)
	h.mustOK(h.job(protocol.JobVolumeResize, map[string]interface{}{"volumeRef": volRef, "sizeGb": 300}))
	if called != "vm-disks/vm-900000-vol-vol1=300" {
		t.Fatalf("rbd resize not called as expected: %q", called)
	}

	h.mustOK(h.job(protocol.JobVolumeDelete, map[string]interface{}{"volumeRef": volRef}))
	if _, exists := h.sim.Volumes["vm-900000-vol-vol1"]; exists {
		t.Fatal("image not freed")
	}
	h.mustOK(h.job(protocol.JobVolumeDelete, map[string]interface{}{"volumeRef": volRef})) // idempotent
}

func TestRejectsWrongToken(t *testing.T) {
	sim := pvesim.New("pve1")
	defer sim.Close()
	log := slog.New(slog.NewTextHandler(os.Stderr, nil))
	c := proxmox.New(config.Proxmox{URL: sim.URL(), Node: "pve1", TokenID: sim.TokenID, TokenSecret: "wrong", Storage: sim.Storage}, log)
	_, err := c.NextID(context.Background())
	if err == nil || !strings.Contains(err.Error(), "401") {
		t.Fatalf("expected 401 with a wrong token, got %v", err)
	}
}

func mustJSON(v interface{}) []byte { b, _ := json.Marshal(v); return b }
func itoa(i int) string             { return strings.TrimSpace(strings.Replace(string(mustJSON(i)), "\"", "", -1)) }

// A project's VNet is created in the VXLAN zone once, applied, and its servers' net0 sits on it.
func TestEnsureVNetAndServerOnIt(t *testing.T) {
	h := newHarness(t)
	vnet := map[string]interface{}{"vnet": "pn255s", "zone": "tenants", "tag": 100000, "alias": "project proj_1"}

	if r := h.job(protocol.JobEnsureVNet, vnet); r.OK || r.Error.Code != "sdn_zone_missing" || r.Error.Retryable {
		t.Fatalf("expected a permanent sdn_zone_missing without the zone, got %+v", r)
	}
	h.sim.AddZone("tenants", "vxlan")
	r := h.mustOK(h.job(protocol.JobEnsureVNet, vnet))
	if res := r.Result.(map[string]interface{}); res["created"] != true || res["applied"] != true {
		t.Fatalf("vnet not created and applied: %v", res)
	}
	if v := h.sim.GetVNet("pn255s"); v == nil || v.Zone != "tenants" || v.Tag != 100000 || v.Pending || h.sim.SDNApplyCount() != 1 {
		t.Fatalf("vnet state wrong: %+v, applies %d", v, h.sim.SDNApplyCount())
	}
	// Idempotent: nothing to create or apply the second time.
	r = h.mustOK(h.job(protocol.JobEnsureVNet, vnet))
	if res := r.Result.(map[string]interface{}); res["created"] != false || res["applied"] != false || h.sim.SDNApplyCount() != 1 {
		t.Fatalf("second ensure changed something: %v, applies %d", res, h.sim.SDNApplyCount())
	}
	// The same id with another tag is a conflict, not something to paper over.
	if r := h.job(protocol.JobEnsureVNet, map[string]interface{}{"vnet": "pn255s", "zone": "tenants", "tag": 100001}); r.OK || r.Error.Code != "sdn_vnet_conflict" {
		t.Fatalf("expected sdn_vnet_conflict, got %+v", r)
	}
	h.sim.AddZone("plain", "simple")
	if r := h.job(protocol.JobEnsureVNet, map[string]interface{}{"vnet": "pn255t", "zone": "plain", "tag": 100001}); r.OK || r.Error.Code != "sdn_zone_type" {
		t.Fatalf("expected sdn_zone_type for a simple zone, got %+v", r)
	}

	sp := spec("srv_vnet")
	sp.PrivateBridge = "pn255s"
	vmid, _ := vmidOf(t, h.mustOK(h.job(protocol.JobCreate, map[string]interface{}{"spec": sp})))
	vm := h.sim.VM(vmid)
	if !strings.HasSuffix(vm.Config["net0"], ",bridge=pn255s,firewall=1,mtu=1") || vm.Config["ipconfig0"] != "ip=10.96.0.2/24" || vm.Status != "running" {
		t.Fatalf("net0 not on the project's vnet: %v (%s)", vm.Config, vm.Status)
	}
	// A VNet that was never applied has no bridge on the node: the VM cannot start and is removed.
	sp = spec("srv_novnet")
	sp.PrivateBridge = "pnmissing"
	if r := h.job(protocol.JobCreate, map[string]interface{}{"spec": sp}); r.OK || !strings.Contains(r.Error.Message, "bridge 'pnmissing' does not exist") {
		t.Fatalf("expected the start to fail on a missing bridge, got %+v", r)
	}
}

// The IP filter only lets each NIC send from its allocated addresses, and never cuts off a NIC
// whose static address the control plane does not confirm.
func TestIPFilter(t *testing.T) {
	h := newHarness(t)
	vmid, ref := vmidOf(t, h.mustOK(h.job(protocol.JobCreate, map[string]interface{}{"spec": spec("srv_ipf")})))
	rules := []protocol.FirewallRule{{Direction: "inbound", Protocol: "tcp", Ports: "22", Cidrs: []string{"0.0.0.0/0"}}}
	apply := func(addrs map[string][]string) *pvesim.VM {
		t.Helper()
		params := map[string]interface{}{"vmRef": ref, "rules": rules}
		if addrs != nil {
			params["addresses"] = addrs
		}
		h.mustOK(h.job(protocol.JobApplyFirewall, params))
		return h.sim.VM(vmid)
	}

	// A load balancer node: its own public address plus the VIP keepalived may move onto it.
	vm := apply(map[string][]string{"net0": {"10.96.0.2"}, "net1": {"203.0.113.10", "203.0.113.50"}})
	if vm.FWOpts["ipfilter"] != "1" || strings.Join(vm.IPSets["ipfilter-net0"], ",") != "10.96.0.2" || strings.Join(vm.IPSets["ipfilter-net1"], ",") != "203.0.113.10,203.0.113.50" {
		t.Fatalf("ip filter not set: opts %v sets %v", vm.FWOpts, vm.IPSets)
	}
	vm = apply(map[string][]string{"net0": {"10.96.0.2"}, "net1": {"203.0.113.10"}})
	if strings.Join(vm.IPSets["ipfilter-net1"], ",") != "203.0.113.10" {
		t.Fatalf("stale address kept in the set: %v", vm.IPSets)
	}
	// An address the VM is not configured with (a restore to an older config): that NIC stays
	// unfiltered and the filter goes off, so nothing is cut off.
	vm = apply(map[string][]string{"net0": {"10.96.0.9"}, "net1": {"203.0.113.10"}})
	if _, has := vm.IPSets["ipfilter-net0"]; has || vm.FWOpts["ipfilter"] != "0" || len(vm.IPSets["ipfilter-net1"]) != 1 {
		t.Fatalf("unconfirmed nic filtered: opts %v sets %v", vm.FWOpts, vm.IPSets)
	}
	// Floating addresses keep the net1 set in step while the filter is on.
	apply(map[string][]string{"net0": {"10.96.0.2"}, "net1": {"203.0.113.10"}})
	h.mustOK(h.job(protocol.JobDetachIP, map[string]interface{}{"vmRef": ref, "address": "203.0.113.10"}))
	if _, has := h.sim.VM(vmid).IPSets["ipfilter-net1"]; has {
		t.Fatal("net1 set left behind after detach")
	}
	h.mustOK(h.job(protocol.JobAttachIP, map[string]interface{}{"vmRef": ref, "ip": protocol.PublicIP{Address: "198.51.100.7", Gateway: "198.51.100.1", Prefix: 24}}))
	if got := h.sim.VM(vmid).IPSets["ipfilter-net1"]; strings.Join(got, ",") != "198.51.100.7" {
		t.Fatalf("attached address not allowed on net1: %v", got)
	}
	// An older control plane sends no addresses: the filter goes off.
	if vm := apply(nil); vm.FWOpts["ipfilter"] != "0" {
		t.Fatalf("ip filter left on without addresses: %v", vm.FWOpts)
	}

	// A server still on DHCP is never filtered on net0.
	sp := spec("srv_ipf_dhcp")
	sp.PrivateIP = nil
	dvmid, dref := vmidOf(t, h.mustOK(h.job(protocol.JobCreate, map[string]interface{}{"spec": sp})))
	h.mustOK(h.job(protocol.JobApplyFirewall, map[string]interface{}{"vmRef": dref, "rules": rules, "addresses": map[string][]string{"net1": {"203.0.113.10"}}}))
	if d := h.sim.VM(dvmid); d.FWOpts["ipfilter"] != "0" || d.IPSets["ipfilter-net0"] != nil {
		t.Fatalf("dhcp nic filtered: opts %v sets %v", d.FWOpts, d.IPSets)
	}
}
