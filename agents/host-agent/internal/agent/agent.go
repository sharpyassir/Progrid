// Package agent wires NATS jobs to the Proxmox client and publishes heartbeats + usage.
package agent

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/nats-io/nats.go"

	"github.com/pgcloud/host-agent/internal/config"
	"github.com/pgcloud/host-agent/internal/protocol"
	"github.com/pgcloud/host-agent/internal/proxmox"
)

// snippetsDir is where cloud-init user-data lands so Proxmox can serve it as a snippet.
// PGCLOUD_SNIPPETS_DIR overrides it (the test harness points it at a temp dir).
func snippetsDir() string {
	if d := os.Getenv("PGCLOUD_SNIPPETS_DIR"); d != "" {
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
}

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
		nats.Name("pgcloud-agent-" + cfg.Proxmox.Node),
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
	return &Agent{cfg: cfg, pve: pve, nc: nc, log: log.With("node", cfg.Proxmox.Node), version: version, jobs: map[string]*jobEntry{}, netOut: map[int]int64{}}, nil
}

func (a *Agent) Run(ctx context.Context) error {
	subject := "pgcloud.host." + a.cfg.HostID + ".jobs"
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
		hb.Vms = append(hb.Vms, protocol.VmBrief{VmRef: string(refJSON), Power: vm.Status})
		hb.UsedVcpu += vm.Cpus
		hb.UsedMemoryMb += vm.MaxMem >> 20

		// Servers are metered whenever they exist (running or off), like the control plane fallback.
		if ref.ServerID != "" {
			a.publish("pgcloud.usage", protocol.UsageEvent{
				V: 1, At: now.Format(time.RFC3339), ResourceType: "server", ResourceID: ref.ServerID, ProjectID: ref.ProjectID,
				HostID: a.cfg.HostID, Quantity: 1, Unit: "minute", Meta: map[string]interface{}{"power": vm.Status, "cpu": vm.CPU},
			})
			a.publish("pgcloud.metrics", protocol.MetricSample{
				V: 1, At: now.Format(time.RFC3339), ServerID: ref.ServerID, HostID: a.cfg.HostID, Power: vm.Status,
				CpuPercent: vm.CPU * 100, MemoryUsedMb: vm.Mem >> 20, MemoryTotalMb: vm.MaxMem >> 20,
				NetInBytes: vm.NetIn, NetOutBytes: vm.NetOut, DiskReadBytes: vm.DiskRead, DiskWriteBytes: vm.DiskWrite,
			})
			if delta := a.netOutDelta(vm.VMID, vm.NetOut); delta > 0 {
				a.publish("pgcloud.usage", protocol.UsageEvent{
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
	a.publish("pgcloud.host."+a.cfg.HostID+".heartbeat", hb)
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
			os.Remove(filepath.Join(snippetsDir(), fmt.Sprintf("pgcloud-%d-user.yaml", ref.VMID)))
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
		name := "pg" + strings.ToLower(p.SnapshotID)
		if err := a.pve.Snapshot(ctx, ref.VMID, name); err != nil {
			return nil, err
		}
		sref, _ := json.Marshal(protocol.SnapshotRef{VMID: ref.VMID, Node: ref.Node, Name: name})
		st, _ := a.pve.Status(ctx, ref.VMID)
		var sizeGb float64
		if st != nil {
			sizeGb = float64(st.Mem>>30) + 1 // TODO: read actual RBD snapshot size via `rbd du`
		}
		return map[string]interface{}{"snapshotRef": string(sref), "sizeGb": sizeGb}, nil

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
		}
		json.Unmarshal(job.Params, &p)
		ref, err := parseRef(p.VmRef)
		if err != nil {
			return nil, err
		}
		return nil, a.pve.SetFirewall(ctx, ref.VMID, toPVERules(p.Rules))

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
			// Detached images have no Proxmox API for resize; use the rbd tool on the node.
			pool := a.cfg.Proxmox.CephPool
			if pool == "" {
				pool = vol.Storage
			}
			return nil, rbdResize(ctx, pool, vol.Volume, p.SizeGb)
		default:
			return nil, a.pve.FreeVolume(ctx, volid)
		}

	case protocol.JobAttachIP, protocol.JobDetachIP:
		// Public IPs are configured at create time via cloud-init (ipconfig1). Floating
		// IP moves are phase 2 and need a config + guest-agent network reload here.
		return nil, permanent{"not_implemented", fmt.Errorf("%s: floating IPs are phase 2", job.Kind)}

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
			path := filepath.Join(snippetsDir(), fmt.Sprintf("pgcloud-%d-user.yaml", vmid))
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
		Tags: "pgcloud;server-" + spec.ServerID + ";project-" + strings.TrimPrefix(spec.NetworkRef, "vpc-"),
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
	return protocol.VmHandle{VmRef: string(ref)}, nil
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
			return a.status(ctx, vmid)
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

func toPVERules(rules []protocol.FirewallRule) []proxmox.FWRule {
	out := make([]proxmox.FWRule, 0, len(rules)*2)
	for _, r := range rules {
		typ := "in"
		if r.Direction == "outbound" {
			typ = "out"
		}
		for _, cidr := range r.Cidrs {
			fr := proxmox.FWRule{Type: typ, Action: "ACCEPT", Proto: r.Protocol, Dport: r.Ports}
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
