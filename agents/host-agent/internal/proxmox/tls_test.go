package proxmox

import (
	"context"
	"crypto/sha256"
	"encoding/pem"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/prgd/host-agent/internal/config"
)

func quietLog() *slog.Logger { return slog.New(slog.NewTextHandler(io.Discard, nil)) }

// tlsPVE is a TLS server answering like the PVE API (a self-signed certificate, as on a fresh node).
func tlsPVE(t *testing.T) *httptest.Server {
	t.Helper()
	srv := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprint(w, `{"data":{"version":"8.2"}}`)
	}))
	t.Cleanup(srv.Close)
	return srv
}

func fingerprintOf(srv *httptest.Server, colons bool) string {
	sum := sha256.Sum256(srv.Certificate().Raw)
	if !colons {
		return fmt.Sprintf("%x", sum)
	}
	parts := make([]string, len(sum))
	for i, b := range sum {
		parts[i] = fmt.Sprintf("%02X", b)
	}
	return strings.Join(parts, ":")
}

func call(c *Client) error {
	var out map[string]string
	return c.do(context.Background(), http.MethodGet, "/version", nil, &out)
}

func TestTLSDefaultRejectsSelfSigned(t *testing.T) {
	srv := tlsPVE(t)
	if err := call(New(config.Proxmox{URL: srv.URL, Node: "pve1"}, quietLog())); err == nil {
		t.Fatal("a self-signed certificate must fail verification without ca_file, fingerprint or insecure")
	}
}

func TestTLSFingerprintPinAcceptsMatchingCert(t *testing.T) {
	srv := tlsPVE(t)
	for _, colons := range []bool{true, false} {
		c := New(config.Proxmox{URL: srv.URL, Node: "pve1", Fingerprint: fingerprintOf(srv, colons)}, quietLog())
		if err := call(c); err != nil {
			t.Fatalf("pinned fingerprint (colons=%v) rejected: %v", colons, err)
		}
	}
}

func TestTLSFingerprintPinRejectsOtherCert(t *testing.T) {
	srv := tlsPVE(t)
	other := strings.Repeat("ab", 32)
	// insecure: true must not weaken a pin.
	c := New(config.Proxmox{URL: srv.URL, Node: "pve1", Fingerprint: other, Insecure: true}, quietLog())
	err := call(c)
	if err == nil || !strings.Contains(err.Error(), "fingerprint") {
		t.Fatalf("a different certificate must be rejected by the pin, got %v", err)
	}
}

func TestTLSCAFileVerifiesChain(t *testing.T) {
	srv := tlsPVE(t)
	ca := filepath.Join(t.TempDir(), "pve-root-ca.pem")
	if err := os.WriteFile(ca, pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: srv.Certificate().Raw}), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := call(New(config.Proxmox{URL: srv.URL, Node: "pve1", CAFile: ca}, quietLog())); err != nil {
		t.Fatalf("certificate signed by ca_file rejected: %v", err)
	}
	// ca_file plus a wrong pin: both must hold.
	if err := call(New(config.Proxmox{URL: srv.URL, Node: "pve1", CAFile: ca, Fingerprint: strings.Repeat("00", 32)}, quietLog())); err == nil {
		t.Fatal("ca_file with a non matching fingerprint must fail")
	}
	// ca_file plus the right pin.
	if err := call(New(config.Proxmox{URL: srv.URL, Node: "pve1", CAFile: ca, Fingerprint: fingerprintOf(srv, true)}, quietLog())); err != nil {
		t.Fatalf("ca_file with the matching fingerprint rejected: %v", err)
	}
}

func TestTLSCAFileOverridesInsecure(t *testing.T) {
	srv := tlsPVE(t)
	// A ca_file that holds no certificate.
	ca := filepath.Join(t.TempDir(), "ca.pem")
	if err := os.WriteFile(ca, []byte("not a certificate"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := TLSConfig(config.Proxmox{CAFile: ca}); err == nil {
		t.Fatal("a ca_file without a PEM certificate must be an error")
	}
	// New fails closed on a bad ca_file even with insecure: true.
	if err := call(New(config.Proxmox{URL: srv.URL, Node: "pve1", CAFile: ca, Insecure: true}, quietLog())); err == nil {
		t.Fatal("a broken ca_file must not fall back to no verification")
	}
}

func TestTLSInsecureStillWorksForLabs(t *testing.T) {
	srv := tlsPVE(t)
	if err := call(New(config.Proxmox{URL: srv.URL, Node: "pve1", Insecure: true}, quietLog())); err != nil {
		t.Fatalf("insecure: true must keep working: %v", err)
	}
}
