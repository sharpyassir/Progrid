package config

import (
	"os"
	"path/filepath"
	"testing"
)

func write(t *testing.T, body string) string {
	t.Helper()
	p := filepath.Join(t.TempDir(), "agent.yaml")
	if err := os.WriteFile(p, []byte(body), 0o600); err != nil {
		t.Fatal(err)
	}
	return p
}

const base = "host_id: h1\nproxmox:\n  url: https://127.0.0.1:8006\n  node: pve1\n"

func TestStorageTypeDefaultsToRBD(t *testing.T) {
	cfg, err := Load(write(t, base))
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Proxmox.StorageType != StorageRBD || cfg.Proxmox.Storage != "vm-disks" || cfg.Proxmox.CephPool != "vm-disks" {
		t.Fatalf("defaults wrong: %+v", cfg.Proxmox)
	}
}

func TestStorageTypeLVMThin(t *testing.T) {
	cfg, err := Load(write(t, base+"  storage: vm-disks\n  storage_type: lvmthin\n"))
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Proxmox.StorageType != StorageLVMThin {
		t.Fatalf("storage_type not read: %+v", cfg.Proxmox)
	}
}

func TestStorageTypeUnknownIsRejected(t *testing.T) {
	if _, err := Load(write(t, base+"  storage_type: zfs\n")); err == nil {
		t.Fatal("an unknown storage_type must be rejected")
	}
}

func TestFingerprintIsNormalized(t *testing.T) {
	fp := "AB:" + "CD:" + "EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89"
	cfg, err := Load(write(t, base+"  fingerprint: \""+fp+"\"\n"))
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Proxmox.Fingerprint != "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789" {
		t.Fatalf("fingerprint not normalized: %q", cfg.Proxmox.Fingerprint)
	}
}

func TestBadFingerprintIsRejected(t *testing.T) {
	if _, err := Load(write(t, base+"  fingerprint: \"AB:CD\"\n")); err == nil {
		t.Fatal("a short fingerprint must be rejected")
	}
}

func TestMissingCAFileIsRejected(t *testing.T) {
	if _, err := Load(write(t, base+"  ca_file: /nonexistent/pve-root-ca.pem\n")); err == nil {
		t.Fatal("an unreadable ca_file must be rejected at load")
	}
}
