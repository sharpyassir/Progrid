package proxmox

import (
	"net/url"
	"strings"
	"testing"
)

func TestEncodeSSHKeys(t *testing.T) {
	keys := []string{
		"ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIB+x/y= alice@laptop",
		"ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABAQC+abc== bob key",
	}
	got := EncodeSSHKeys(keys)
	if strings.Contains(got, "+") {
		t.Fatalf("encoded keys contain a plus sign: %s", got)
	}
	if strings.Contains(got, " ") || strings.Contains(got, "\n") {
		t.Fatalf("encoded keys contain a raw space or newline: %s", got)
	}
	if !strings.Contains(got, "ssh-ed25519%20AAAA") || !strings.Contains(got, "%0Assh-rsa%20") {
		t.Fatalf("spaces must be %%20 and newlines %%0A: %s", got)
	}
	// Proxmox decodes with plain percent decoding; the keys must come back unchanged.
	dec, err := url.PathUnescape(got)
	if err != nil || dec != strings.Join(keys, "\n") {
		t.Fatalf("round trip failed: %q, %v", dec, err)
	}
}
