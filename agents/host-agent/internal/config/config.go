package config

import (
	"fmt"
	"os"
	"time"

	"gopkg.in/yaml.v3"
)

// Storage types the agent knows how to resize detached volumes on and size snapshots for.
const (
	StorageRBD     = "rbd"     // Ceph RBD: rbd resize and rbd du
	StorageLVMThin = "lvmthin" // local LVM thin pool: lvresize; snapshot sizes are estimated
)

type Proxmox struct {
	URL          string `yaml:"url"`           // https://127.0.0.1:8006
	Node         string `yaml:"node"`          // pve1
	TokenID      string `yaml:"token_id"`      // prgd@pve!agent
	TokenSecret  string `yaml:"token_secret"`  // from Vault / env PVE_TOKEN_SECRET
	Storage      string `yaml:"storage"`       // storage id VM disks and volumes go on, e.g. "vm-disks"
	StorageType  string `yaml:"storage_type"`  // "rbd" (Ceph, default) or "lvmthin" (single node lab on local LVM thin)
	CephPool     string `yaml:"ceph_pool"`     // Ceph pool behind that storage, used by rbd resize for detached volumes (rbd only)
	Bridge       string `yaml:"bridge"`        // shared private bridge for net0 when the control plane names no project VNet, e.g. "customers"
	PublicBridge string `yaml:"public_bridge"` // bridge carrying our public IP blocks, e.g. "vmbr0"
	Insecure     bool   `yaml:"insecure"`      // skip TLS verify for the local PVE cert
}

type Config struct {
	HostID    string        `yaml:"host_id"` // control plane Host.id, given at registration
	NATSURL   string        `yaml:"nats_url"`
	NATSCreds string        `yaml:"nats_creds"` // path to .creds (NKey/JWT); empty for dev
	NATSToken string        `yaml:"nats_token"` // shared token (--auth on the server); NATS_TOKEN env overrides
	Heartbeat time.Duration `yaml:"heartbeat"`  // default 60s
	Proxmox   Proxmox       `yaml:"proxmox"`
}

func Load(path string) (*Config, error) {
	cfg := &Config{Heartbeat: 60 * time.Second, NATSURL: "nats://127.0.0.1:4222"}
	b, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read %s: %w", path, err)
	}
	if err := yaml.Unmarshal(b, cfg); err != nil {
		return nil, fmt.Errorf("parse %s: %w", path, err)
	}
	if s := os.Getenv("PVE_TOKEN_SECRET"); s != "" {
		cfg.Proxmox.TokenSecret = s
	}
	if cfg.HostID == "" {
		return nil, fmt.Errorf("host_id is required (register the host in the back-office first)")
	}
	if cfg.Proxmox.Node == "" || cfg.Proxmox.URL == "" {
		return nil, fmt.Errorf("proxmox.url and proxmox.node are required")
	}
	if cfg.Proxmox.Storage == "" {
		cfg.Proxmox.Storage = "vm-disks"
	}
	switch cfg.Proxmox.StorageType {
	case "":
		cfg.Proxmox.StorageType = StorageRBD
	case StorageRBD, StorageLVMThin:
	default:
		return nil, fmt.Errorf("proxmox.storage_type must be %q or %q, not %q", StorageRBD, StorageLVMThin, cfg.Proxmox.StorageType)
	}
	if cfg.Proxmox.CephPool == "" {
		cfg.Proxmox.CephPool = cfg.Proxmox.Storage
	}
	if cfg.Proxmox.Bridge == "" {
		cfg.Proxmox.Bridge = "customers"
	}
	if cfg.Proxmox.PublicBridge == "" {
		cfg.Proxmox.PublicBridge = "vmbr0"
	}
	return cfg, nil
}
