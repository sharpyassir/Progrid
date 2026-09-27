package agent_test

import (
	"context"
	"encoding/json"
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
	if vm.Config["net1"] != "virtio,bridge=vmbr0,firewall=1" || !strings.HasPrefix(vm.Config["ipconfig1"], "ip=203.0.113.10/24,gw=203.0.113.1") {
		t.Fatalf("public network not configured: %v", vm.Config)
	}
	if !strings.HasPrefix(vm.Config["cicustom"], "user=local:snippets/pgcloud-") {
		t.Fatalf("cloud-init snippet not referenced: %v", vm.Config)
	}
	if b, err := os.ReadFile(filepath.Join(os.Getenv("PGCLOUD_SNIPPETS_DIR"), "pgcloud-"+itoa(vmid)+"-user.yaml")); err != nil || !strings.Contains(string(b), "hostname: web-1") {
		t.Fatalf("user-data snippet not written: %v", err)
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
	if r.OK || r.Error.Code != "not_implemented" || r.Error.Retryable {
		t.Fatalf("expected not_implemented, got %+v", r)
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
