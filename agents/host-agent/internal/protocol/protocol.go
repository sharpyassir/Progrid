// Package protocol mirrors apps/api/src/drivers/agent-protocol.ts. Keep in sync.
package protocol

import "encoding/json"

const (
	JobCreate        = "vm.create"
	JobWaitBoot      = "vm.wait_boot"
	JobStart         = "vm.start"
	JobStop          = "vm.stop"
	JobReboot        = "vm.reboot"
	JobDelete        = "vm.delete"
	JobResize        = "vm.resize"
	JobStatus        = "vm.status"
	JobFindByTag     = "vm.find_by_tag"
	JobRollback      = "vm.rollback"
	JobSnapshot      = "vm.snapshot"
	JobSnapshotDel   = "snapshot.delete"
	JobAttachIP      = "net.attach_ip"
	JobDetachIP      = "net.detach_ip"
	JobApplyFirewall = "net.apply_firewall"
	JobEnsureVNet    = "net.ensure_vnet"
	JobVolumeCreate  = "volume.create"
	JobVolumeAttach  = "volume.attach"
	JobVolumeDetach  = "volume.detach"
	JobVolumeResize  = "volume.resize"
	JobVolumeDelete  = "volume.delete"
)

type Job struct {
	ID       string          `json:"id"`
	Kind     string          `json:"kind"`
	Params   json.RawMessage `json:"params"`
	IssuedAt string          `json:"issuedAt"`
}

type JobError struct {
	Code      string `json:"code"`
	Message   string `json:"message"`
	Retryable bool   `json:"retryable"`
}

type JobResult struct {
	JobID  string      `json:"jobId"`
	OK     bool        `json:"ok"`
	Result interface{} `json:"result,omitempty"`
	Error  *JobError   `json:"error,omitempty"`
}

type PublicIP struct {
	Address string `json:"address"`
	Gateway string `json:"gateway"`
	Prefix  int    `json:"prefix"`
}

// PrivateIP is the static address of the private NIC (net0), allocated by the control plane.
// There is no gateway: the default route belongs to the public NIC.
type PrivateIP struct {
	Address string `json:"address"`
	Prefix  int    `json:"prefix"`
}

type VmSpec struct {
	ServerID string `json:"serverId"`
	Name     string `json:"name"`
	Hostname string `json:"hostname"`
	Vcpu     int    `json:"vcpu"`
	MemoryMb int    `json:"memoryMb"`
	DiskGb   int    `json:"diskGb"`
	// ImageRef is a template ref {"template":9000} or, to create from a snapshot, the
	// snapshot ref {"vmid":123,"node":"pve1","name":"pgsnap"}.
	ImageRef   string    `json:"imageRef"`
	SshKeys    []string  `json:"sshKeys"`
	UserData   string    `json:"userData"`
	NetworkRef string    `json:"networkRef"`
	PublicIP   *PublicIP `json:"publicIp,omitempty"`
	// PrivateIP is nil for control planes that predate allocation; net0 then uses DHCP.
	PrivateIP *PrivateIP `json:"privateIp,omitempty"`
	// PrivateBridge is the project's SDN VNet for net0 (PRIVATE_NETWORK_MODE=sdn_vnet). Empty
	// means the agent's shared bridge.
	PrivateBridge string `json:"privateBridge,omitempty"`
}

// VNetSpec asks for a project's VNet in the VXLAN zone (net.ensure_vnet).
type VNetSpec struct {
	VNet  string `json:"vnet"`
	Zone  string `json:"zone"`
	Tag   int    `json:"tag"`
	Alias string `json:"alias,omitempty"`
}

type VmHandle struct {
	VmRef     string `json:"vmRef"`
	PrivateIP string `json:"privateIp,omitempty"`
}

type VmStatus struct {
	Power        string  `json:"power"` // running | stopped | unknown
	CpuPercent   float64 `json:"cpuPercent,omitempty"`
	MemoryUsedMb int64   `json:"memoryUsedMb,omitempty"`
	UptimeSec    int64   `json:"uptimeSec,omitempty"`
	// GuestAddresses are the addresses the guest reports through the QEMU guest agent
	// (loopback and link local left out). Only wait_boot fills them.
	GuestAddresses []string `json:"guestAddresses,omitempty"`
}

type FirewallRule struct {
	Direction string   `json:"direction"` // inbound | outbound
	Protocol  string   `json:"protocol"`  // tcp | udp | icmp | any
	Ports     string   `json:"ports,omitempty"`
	Cidrs     []string `json:"cidrs"`
}

type Heartbeat struct {
	HostID        string    `json:"hostId"`
	Node          string    `json:"node"`
	At            string    `json:"at"`
	TotalVcpu     int       `json:"totalVcpu"`
	TotalMemoryMb int64     `json:"totalMemoryMb"`
	TotalDiskGb   int64     `json:"totalDiskGb"`
	UsedVcpu      int       `json:"usedVcpu"`
	UsedMemoryMb  int64     `json:"usedMemoryMb"`
	UsedDiskGb    int64     `json:"usedDiskGb"`
	Vms           []VmBrief `json:"vms"`
	AgentVersion  string    `json:"agentVersion"`
}

type VmBrief struct {
	VmRef string `json:"vmRef"`
	Power string `json:"power"`
	// ServerID comes from the VM's tags, so the control plane can match the VM without parsing vmRef.
	ServerID string `json:"serverId,omitempty"`
	// Addresses the guest agent reports for a running VM, refreshed every few minutes.
	Addresses []string `json:"addresses,omitempty"`
}

// SnapshotRef is the opaque handle stored in Snapshot.driverRef for the Proxmox driver.
type SnapshotRef struct {
	VMID int    `json:"vmid"`
	Node string `json:"node"`
	Name string `json:"name"`
}

// UsageEvent is usage.v1: one per resource per minute.
// Bandwidth events carry the outbound bytes since the previous tick, not since boot.
type UsageEvent struct {
	V            int                    `json:"v"`
	At           string                 `json:"at"`
	ResourceType string                 `json:"resourceType"`
	ResourceID   string                 `json:"resourceId"`
	ProjectID    string                 `json:"projectId"`
	HostID       string                 `json:"hostId"`
	Quantity     float64                `json:"quantity"`
	Unit         string                 `json:"unit"`
	Meta         map[string]interface{} `json:"meta,omitempty"`
}

// MetricSample is metrics.v1: one per VM per minute, raw counters from the hypervisor.
// Network and disk counters are cumulative bytes since boot; the control plane derives rates.
type MetricSample struct {
	V              int     `json:"v"`
	At             string  `json:"at"`
	ServerID       string  `json:"serverId"`
	HostID         string  `json:"hostId"`
	Power          string  `json:"power"`
	CpuPercent     float64 `json:"cpuPercent"`
	MemoryUsedMb   int64   `json:"memoryUsedMb"`
	MemoryTotalMb  int64   `json:"memoryTotalMb"`
	NetInBytes     int64   `json:"netInBytes"`
	NetOutBytes    int64   `json:"netOutBytes"`
	DiskReadBytes  int64   `json:"diskReadBytes"`
	DiskWriteBytes int64   `json:"diskWriteBytes"`
}

// VolumeRef is the opaque handle stored in Volume.driverRef for the Proxmox driver.
// Images are owned by the reserved vmid 900000 so Proxmox never treats them as a VM's own disk.
type VolumeRef struct {
	Storage string `json:"storage"`
	Volume  string `json:"volume"` // vm-900000-vol-<id>
}

// VmRef is the opaque handle stored in Server.driverRef for the Proxmox driver.
type VmRef struct {
	VMID int    `json:"vmid"`
	Node string `json:"node"`
	// Carried so usage events can be attributed without a control-plane lookup.
	ServerID  string `json:"serverId,omitempty"`
	ProjectID string `json:"projectId,omitempty"`
}
