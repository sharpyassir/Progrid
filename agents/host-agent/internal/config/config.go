package config

import (
	"fmt"
	"os"
	"strings"
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
	Insecure     bool   `yaml:"insecure"`      // skip TLS verify entirely (lab only); ignored when ca_file or fingerprint is set
	// CAFile verifies the PVE API certificate against this CA bundle (PEM), e.g. the cluster CA
	// /etc/pve/pve-root-ca.pem, including the host name or IP of url.
	CAFile string `yaml:"ca_file"`
	// Fingerprint pins the SHA-256 fingerprint of the PVE API leaf certificate (hex, colons
	// optional, as `pvenode cert info` prints it). Works with self-signed certificates: the chain
	// and host name are not checked, the exact certificate is. With ca_file, both must hold.
	Fingerprint string `yaml:"fingerprint"`
}

// NormalizeFingerprint turns "AB:CD:..." or "abcd..." into 64 lowercase hex characters, or
// returns an error when it is not a SHA-256 fingerprint.
func NormalizeFingerprint(fp string) (string, error) {
	s := strings.ToLower(strings.NewReplacer(":", "", " ", "", "-", "").Replace(strings.TrimSpace(fp)))
	if len(s) != 64 || strings.Trim(s, "0123456789abcdef") != "" {
		return "", fmt.Errorf("proxmox.fingerprint must be a SHA-256 fingerprint (64 hex characters, colons optional), got %q", fp)
	}
	return s, nil
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
	if cfg.Proxmox.Fingerprint != "" {
		fp, err := NormalizeFingerprint(cfg.Proxmox.Fingerprint)
		if err != nil {
			return nil, err
		}
		cfg.Proxmox.Fingerprint = fp
	}
	if cfg.Proxmox.CAFile != "" {
		if _, err := os.ReadFile(cfg.Proxmox.CAFile); err != nil {
			return nil, fmt.Errorf("proxmox.ca_file: %w", err)
		}
	}
	if cfg.Proxmox.PublicBridge == "" {
		cfg.Proxmox.PublicBridge = "vmbr0"
	}
	return cfg, nil
}
