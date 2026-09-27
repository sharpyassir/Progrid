// Package pvesim is a small in memory stand in for the Proxmox VE REST API. It serves
// exactly the endpoints the agent uses, with the same JSON envelope, task UPIDs and
// error texts, so the agent can be exercised end to end without a hypervisor.
//
// It is deliberately literal rather than clever: every handler is a few lines you can
// read next to the real API docs. Faults can be injected per operation to test retries.
package pvesim

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"
)

// VM is the simulated machine state.
type VM struct {
	VMID     int
	Name     string
	Template bool
	Status   string // running | stopped
	Cores    int
	MemoryMb int
	DiskGb   int
	Tags     string
	NetOut   int64             // outbound byte counter since boot
	Config   map[string]string // last /config form, for assertions
	Snaps    []string
	// Source is "<vmid>" for a template clone or "<vmid>@<snapname>" for a snapshot clone.
	Source string
	// RolledBackTo is the snapshot of the last rollback.
	RolledBackTo string
	// CloudInitRegens counts PUT /cloudinit calls (the drive is rebuilt after a network change).
	CloudInitRegens int
	FWRules         []map[string]string
	FWOpts          map[string]string
	StartedAt       time.Time
}

type task struct {
	done time.Time
	exit string
}

// Sim is one node. Create it with New and pass URL() to the agent config.
type Sim struct {
	Node        string
	Storage     string
	TokenID     string
	TokenSecret string
	// BootDelay is how long after start the guest agent answers ping (cloud-init done).
	BootDelay time.Duration
	// TaskDelay is how long a UPID stays "running" before it finishes.
	TaskDelay time.Duration

	// Volumes are standalone images on the storage: name → size in GB.
	Volumes map[string]int

	mu     sync.Mutex
	vms    map[int]*VM
	tasks  map[string]task
	nextID int
	fail   map[string]int // operation → remaining failures to inject
	calls  []string       // method+path log
	macSeq int            // makes every generated MAC distinct

	srv *httptest.Server
}

// New starts the simulator with one template (vmid 9000) ready to clone.
func New(node string) *Sim {
	s := &Sim{
		Node: node, Storage: "vm-disks", TokenID: "pgcloud@pve!agent", TokenSecret: "secret",
		BootDelay: 200 * time.Millisecond, TaskDelay: 50 * time.Millisecond,
		vms:   map[int]*VM{9000: {VMID: 9000, Name: "ubuntu-24-04-template", Template: true, Status: "stopped", Cores: 1, MemoryMb: 1024, DiskGb: 10}},
		tasks: map[string]task{}, nextID: 100, fail: map[string]int{}, Volumes: map[string]int{},
	}
	s.srv = httptest.NewServer(http.HandlerFunc(s.handle))
	return s
}

func (s *Sim) URL() string { return s.srv.URL }
func (s *Sim) Close()      { s.srv.Close() }

// FailNext makes the next n calls of an operation fail with a 500 task or response.
// Operations: clone, config, resize, start, stop, shutdown, reboot, delete, snapshot, rollback, status, ping.
func (s *Sim) FailNext(op string, n int) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.fail[op] = n
}

// VM returns a copy of the VM or nil.
func (s *Sim) VM(vmid int) *VM {
	s.mu.Lock()
	defer s.mu.Unlock()
	if v, ok := s.vms[vmid]; ok {
		c := *v
		return &c
	}
	return nil
}

// SetNetOut sets a VM's outbound byte counter (a smaller value models a reboot).
func (s *Sim) SetNetOut(vmid int, bytes int64) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if v, ok := s.vms[vmid]; ok {
		v.NetOut = bytes
	}
}

// SnapshotBytes is what RbdDu reports for every snapshot.
const SnapshotBytes int64 = 3 << 30

// RbdDu stands in for `rbd du` on the node: a fixed size for a snapshot that exists on the
// VM that owns the image (vm-<vmid>-disk-0), an error otherwise. Install it with agent.SetRbdDu.
func (s *Sim) RbdDu(_ context.Context, pool, image, snap string) (int64, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	var vmid int
	if _, err := fmt.Sscanf(image, "vm-%d-disk-0", &vmid); err != nil || pool != s.Storage {
		return 0, fmt.Errorf("rbd: error opening image %s/%s", pool, image)
	}
	if vm := s.vms[vmid]; vm == nil || !contains(vm.Snaps, snap) {
		return 0, fmt.Errorf("rbd: snapshot %s@%s does not exist", image, snap)
	}
	return SnapshotBytes, nil
}

// Calls returns the request log ("POST /nodes/pve1/qemu/100/clone" ...).
func (s *Sim) Calls() []string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]string(nil), s.calls...)
}

func (s *Sim) shouldFail(op string) bool {
	if s.fail[op] > 0 {
		s.fail[op]--
		return true
	}
	return false
}

func (s *Sim) newTask(exit string) string {
	upid := fmt.Sprintf("UPID:%s:%08X:%08X:%08X:qm:sim:root@pam:", s.Node, len(s.tasks)+1, time.Now().UnixNano()&0xffffffff, len(s.tasks))
	s.tasks[upid] = task{done: time.Now().Add(s.TaskDelay), exit: exit}
	return upid
}

var (
	reVM   = regexp.MustCompile(`^/nodes/([^/]+)/qemu/(\d+)(/.*)?$`)
	reTask = regexp.MustCompile(`^/nodes/([^/]+)/tasks/([^/]+)/status$`)
)

func (s *Sim) handle(w http.ResponseWriter, r *http.Request) {
	if r.Header.Get("Authorization") != "PVEAPIToken="+s.TokenID+"="+s.TokenSecret {
		http.Error(w, "401 authentication failure", http.StatusUnauthorized)
		return
	}
	path := strings.TrimPrefix(r.URL.Path, "/api2/json")
	_ = r.ParseForm()
	s.mu.Lock()
	defer s.mu.Unlock()
	s.calls = append(s.calls, r.Method+" "+path)

	ok := func(v interface{}) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]interface{}{"data": v})
	}
	fail := func(code int, msg string) { http.Error(w, msg, code) }

	switch {
	case path == "/cluster/nextid" && r.Method == http.MethodGet:
		for s.vms[s.nextID] != nil {
			s.nextID++
		}
		ok(strconv.Itoa(s.nextID))
		return
	case path == "/nodes/"+s.Node+"/status":
		used := int64(0)
		for _, v := range s.vms {
			if v.Status == "running" {
				used += int64(v.MemoryMb) << 20
			}
		}
		ok(map[string]interface{}{"cpuinfo": map[string]int{"cpus": 64}, "memory": map[string]int64{"total": 256 << 30, "used": used}})
		return
	case path == "/nodes/"+s.Node+"/storage/"+s.Storage+"/status":
		used := int64(0)
		for _, v := range s.vms {
			used += int64(v.DiskGb) << 30
		}
		ok(map[string]int64{"total": 4000 << 30, "used": used})
		return
	case path == "/nodes/"+s.Node+"/storage/"+s.Storage+"/content" && r.Method == http.MethodPost:
		name := r.Form.Get("filename")
		if !strings.HasPrefix(name, "vm-") {
			fail(400, "illegal volume name")
			return
		}
		if _, dup := s.Volumes[name]; dup {
			fail(500, "volume '"+name+"' already exists")
			return
		}
		gb, _ := strconv.Atoi(strings.TrimSuffix(r.Form.Get("size"), "G"))
		s.Volumes[name] = gb
		ok(s.Storage + ":" + name)
		return
	case strings.HasPrefix(path, "/nodes/"+s.Node+"/storage/"+s.Storage+"/content/") && r.Method == http.MethodDelete:
		volid := strings.TrimPrefix(path, "/nodes/"+s.Node+"/storage/"+s.Storage+"/content/")
		name := strings.TrimPrefix(volid, s.Storage+":")
		if _, found := s.Volumes[name]; !found {
			fail(500, "volume '"+name+"' does not exist")
			return
		}
		for _, v := range s.vms {
			for k, cv := range v.Config {
				if strings.HasPrefix(k, "scsi") && strings.Contains(cv, name) {
					fail(500, "volume '"+name+"' is still attached to vm "+strconv.Itoa(v.VMID))
					return
				}
			}
		}
		delete(s.Volumes, name)
		ok(s.newTask("OK"))
		return
	case path == "/nodes/"+s.Node+"/qemu" && r.Method == http.MethodGet:
		out := []map[string]interface{}{}
		for _, v := range s.vms {
			t := 0
			if v.Template {
				t = 1
			}
			out = append(out, map[string]interface{}{"vmid": v.VMID, "name": v.Name, "status": v.Status, "cpus": v.Cores, "maxmem": int64(v.MemoryMb) << 20, "mem": int64(v.MemoryMb) << 19, "tags": v.Tags, "cpu": 0.03, "netin": 1000, "netout": v.NetOut, "diskread": 4096, "diskwrite": 8192, "template": t})
		}
		ok(out)
		return
	}

	if m := reTask.FindStringSubmatch(path); m != nil {
		upid, _ := urlUnescape(m[2])
		t, found := s.tasks[upid]
		if !found {
			fail(500, "no such task")
			return
		}
		if time.Now().Before(t.done) {
			ok(map[string]string{"status": "running"})
		} else {
			ok(map[string]string{"status": "stopped", "exitstatus": t.exit})
		}
		return
	}

	m := reVM.FindStringSubmatch(path)
	if m == nil {
		fail(501, "pvesim: unhandled "+r.Method+" "+path)
		return
	}
	vmid, _ := strconv.Atoi(m[2])
	sub := m[3]
	vm := s.vms[vmid]
	exit := func(op string) string {
		if s.shouldFail(op) {
			return op + " failed: simulated fault"
		}
		return "OK"
	}
	notExist := func() {
		fail(500, fmt.Sprintf("Configuration file 'nodes/%s/qemu-server/%d.conf' does not exist", s.Node, vmid))
	}

	switch {
	case sub == "/clone" && r.Method == http.MethodPost:
		if vm == nil {
			notExist()
			return
		}
		if s.shouldFail("clone") {
			fail(500, "clone failed: simulated fault")
			return
		}
		if snap := r.Form.Get("snapname"); snap != "" && !contains(vm.Snaps, snap) {
			fail(500, "snapshot '"+snap+"' does not exist")
			return
		}
		newid, _ := strconv.Atoi(r.Form.Get("newid"))
		s.vms[newid] = &VM{Source: sourceOf(vmid, r.Form.Get("snapname")), VMID: newid, Name: r.Form.Get("name"), Status: "stopped", NetOut: 2000, Cores: vm.Cores, MemoryMb: vm.MemoryMb, DiskGb: vm.DiskGb, Config: map[string]string{}, FWOpts: map[string]string{}}
		ok(s.newTask("OK"))
		return
	case sub == "/config" && r.Method == http.MethodGet:
		if vm == nil {
			notExist()
			return
		}
		out := map[string]interface{}{"cores": vm.Cores, "memory": vm.MemoryMb, "name": vm.Name, "scsi0": s.Storage + ":vm-" + strconv.Itoa(vm.VMID) + "-disk-0,size=" + strconv.Itoa(vm.DiskGb) + "G"}
		for k, v := range vm.Config {
			out[k] = v
		}
		ok(out)
		return
	case sub == "/config" && r.Method == http.MethodPost:
		if vm == nil {
			notExist()
			return
		}
		if s.shouldFail("config") {
			fail(500, "config failed: simulated fault")
			return
		}
		if vm.Config == nil {
			vm.Config = map[string]string{}
		}
		if del := r.Form.Get("delete"); del != "" {
			for _, k := range strings.Split(del, ",") {
				delete(vm.Config, strings.TrimSpace(k))
			}
			ok(nil)
			return
		}
		for k, v := range r.Form {
			if strings.HasPrefix(k, "scsi") && k != "scsi0" {
				volid := strings.SplitN(v[0], ",", 2)[0]
				name := strings.TrimPrefix(volid, s.Storage+":")
				if _, found := s.Volumes[name]; !found {
					fail(500, "volume '"+name+"' does not exist")
					return
				}
			}
			if isNIC(k) {
				v = []string{s.withMAC(v[0], vm.VMID)}
			}
			vm.Config[k] = v[0]
		}
		if c, err := strconv.Atoi(r.Form.Get("cores")); err == nil {
			vm.Cores = c
		}
		if mem, err := strconv.Atoi(r.Form.Get("memory")); err == nil {
			vm.MemoryMb = mem
		}
		// Like Proxmox, a key that is sent is stored even when empty.
		if _, sent := r.Form["name"]; sent {
			vm.Name = r.Form.Get("name")
		}
		if _, sent := r.Form["tags"]; sent {
			vm.Tags = r.Form.Get("tags")
		}
		ok(nil)
		return
	case sub == "/cloudinit" && r.Method == http.MethodPut:
		if vm == nil {
			notExist()
			return
		}
		vm.CloudInitRegens++
		ok(nil)
		return
	case sub == "/resize" && r.Method == http.MethodPut:
		if vm == nil {
			notExist()
			return
		}
		if s.shouldFail("resize") {
			fail(500, "resize failed: simulated fault")
			return
		}
		gb, _ := strconv.Atoi(strings.TrimSuffix(r.Form.Get("size"), "G"))
		if disk := r.Form.Get("disk"); disk != "" && disk != "scsi0" {
			cv, attached := vm.Config[disk]
			if !attached {
				fail(500, "disk '"+disk+"' does not exist")
				return
			}
			name := strings.TrimPrefix(strings.SplitN(cv, ",", 2)[0], s.Storage+":")
			if gb < s.Volumes[name] {
				fail(500, "shrinking disks is not supported")
				return
			}
			s.Volumes[name] = gb
			ok(nil)
			return
		}
		if gb < vm.DiskGb {
			fail(500, "shrinking disks is not supported")
			return
		}
		vm.DiskGb = gb
		ok(nil)
		return
	case strings.HasPrefix(sub, "/status/") && r.Method == http.MethodPost:
		if vm == nil {
			notExist()
			return
		}
		op := strings.TrimPrefix(sub, "/status/")
		e := exit(op)
		if e == "OK" {
			switch op {
			case "start":
				vm.Status, vm.StartedAt = "running", time.Now()
			case "stop", "shutdown":
				vm.Status = "stopped"
			case "reboot":
				vm.StartedAt = time.Now()
			}
		}
		ok(s.newTask(e))
		return
	case sub == "/status/current" && r.Method == http.MethodGet:
		if vm == nil {
			notExist()
			return
		}
		if s.shouldFail("status") {
			fail(500, "status failed: simulated fault")
			return
		}
		up := int64(0)
		if vm.Status == "running" {
			up = int64(time.Since(vm.StartedAt).Seconds())
		}
		ok(map[string]interface{}{"status": vm.Status, "cpu": 0.12, "mem": int64(vm.MemoryMb) << 19, "uptime": up, "netin": 1000, "netout": vm.NetOut})
		return
	case sub == "/agent/ping" && r.Method == http.MethodPost:
		if vm == nil {
			notExist()
			return
		}
		if vm.Status != "running" || time.Since(vm.StartedAt) < s.BootDelay || s.shouldFail("ping") {
			fail(500, "QEMU guest agent is not running")
			return
		}
		ok(map[string]interface{}{})
		return
	case sub == "/snapshot" && r.Method == http.MethodPost:
		if vm == nil {
			notExist()
			return
		}
		e := exit("snapshot")
		if e == "OK" {
			vm.Snaps = append(vm.Snaps, r.Form.Get("snapname"))
		}
		ok(s.newTask(e))
		return
	case strings.HasPrefix(sub, "/snapshot/") && strings.HasSuffix(sub, "/rollback") && r.Method == http.MethodPost:
		if vm == nil {
			notExist()
			return
		}
		name := strings.TrimSuffix(strings.TrimPrefix(sub, "/snapshot/"), "/rollback")
		if !contains(vm.Snaps, name) {
			fail(500, "snapshot '"+name+"' does not exist")
			return
		}
		e := exit("rollback")
		if e == "OK" {
			// Without a saved memory state Proxmox leaves the VM stopped after a rollback.
			vm.Status, vm.RolledBackTo = "stopped", name
		}
		ok(s.newTask(e))
		return
	case strings.HasPrefix(sub, "/snapshot/") && r.Method == http.MethodDelete:
		if vm == nil {
			notExist()
			return
		}
		name := strings.TrimPrefix(sub, "/snapshot/")
		kept := vm.Snaps[:0]
		for _, n := range vm.Snaps {
			if n != name {
				kept = append(kept, n)
			}
		}
		vm.Snaps = kept
		ok(s.newTask("OK"))
		return
	case sub == "/firewall/options" && r.Method == http.MethodPut:
		if vm == nil {
			notExist()
			return
		}
		vm.FWOpts = map[string]string{}
		for k, v := range r.Form {
			vm.FWOpts[k] = v[0]
		}
		ok(nil)
		return
	case sub == "/firewall/rules" && r.Method == http.MethodGet:
		if vm == nil {
			notExist()
			return
		}
		out := []map[string]interface{}{}
		for i, rule := range vm.FWRules {
			e := map[string]interface{}{"pos": i}
			for k, v := range rule {
				e[k] = v
			}
			out = append(out, e)
		}
		ok(out)
		return
	case sub == "/firewall/rules" && r.Method == http.MethodPost:
		if vm == nil {
			notExist()
			return
		}
		rule := map[string]string{}
		for k, v := range r.Form {
			rule[k] = v[0]
		}
		vm.FWRules = append(vm.FWRules, rule)
		ok(nil)
		return
	case strings.HasPrefix(sub, "/firewall/rules/") && r.Method == http.MethodDelete:
		if vm == nil {
			notExist()
			return
		}
		pos, _ := strconv.Atoi(strings.TrimPrefix(sub, "/firewall/rules/"))
		if pos >= 0 && pos < len(vm.FWRules) {
			vm.FWRules = append(vm.FWRules[:pos], vm.FWRules[pos+1:]...)
		}
		ok(nil)
		return
	case (sub == "" || strings.HasPrefix(sub, "?")) && r.Method == http.MethodDelete:
		if vm == nil {
			notExist()
			return
		}
		e := exit("delete")
		if e == "OK" {
			delete(s.vms, vmid)
		}
		ok(s.newTask(e))
		return
	}
	fail(501, "pvesim: unhandled "+r.Method+" "+path)
}

func contains(list []string, v string) bool {
	for _, x := range list {
		if x == v {
			return true
		}
	}
	return false
}

func sourceOf(vmid int, snapname string) string {
	if snapname == "" {
		return strconv.Itoa(vmid)
	}
	return strconv.Itoa(vmid) + "@" + snapname
}

func isNIC(key string) bool {
	if !strings.HasPrefix(key, "net") {
		return false
	}
	_, err := strconv.Atoi(strings.TrimPrefix(key, "net"))
	return err == nil
}

// withMAC mimics Proxmox: a NIC sent as "virtio,bridge=..." without an address gets a fresh
// generated MAC ("virtio=BC:24:11:..."), so resending net0 without its MAC changes it.
func (s *Sim) withMAC(v string, vmid int) string {
	model, rest, _ := strings.Cut(v, ",")
	if strings.Contains(model, "=") {
		return v
	}
	s.macSeq++
	mac := fmt.Sprintf("BC:24:11:%02X:%02X:%02X", vmid%256, s.macSeq/256%256, s.macSeq%256)
	if rest == "" {
		return model + "=" + mac
	}
	return model + "=" + mac + "," + rest
}

func urlUnescape(s string) (string, error) {
	// UPIDs contain ':' which the client path escapes; Go's mux already unescaped the path.
	return s, nil
}
