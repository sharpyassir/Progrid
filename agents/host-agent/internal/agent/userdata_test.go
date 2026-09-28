package agent

import (
	"strings"
	"testing"

	"gopkg.in/yaml.v3"
)

var testKeys = []string{"ssh-ed25519 AAAA alice", "ssh-rsa BBBB bob"}

func TestUserDataMergesCloudConfig(t *testing.T) {
	in := "#cloud-config\npackages: [nginx]\nusers:\n  - name: deploy\n    groups: sudo\nruncmd:\n  - echo hi\n"
	out, err := renderUserData(in, "web-1", testKeys)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(out, "#cloud-config\n") {
		t.Fatalf("missing #cloud-config header: %s", out)
	}
	var cfg map[string]interface{}
	if err := yaml.Unmarshal([]byte(out), &cfg); err != nil {
		t.Fatal(err)
	}
	if cfg["hostname"] != "web-1" || cfg["fqdn"] != "web-1" || cfg["ssh_pwauth"] != false {
		t.Fatalf("hostname or ssh_pwauth missing: %v", cfg)
	}
	if cfg["packages"] == nil || cfg["runcmd"] == nil {
		t.Fatalf("supplied keys lost: %v", cfg)
	}
	users := cfg["users"].([]interface{})
	if len(users) != 2 || users[0].(map[string]interface{})["name"] != "deploy" {
		t.Fatalf("supplied users lost: %v", users)
	}
	root := users[1].(map[string]interface{})
	if root["name"] != "root" || len(root["ssh_authorized_keys"].([]interface{})) != 2 {
		t.Fatalf("root keys missing: %v", root)
	}
}

func TestUserDataKeepsSuppliedHostname(t *testing.T) {
	out, err := renderUserData("#cloud-config\nhostname: custom\n", "web-1", testKeys)
	if err != nil {
		t.Fatal(err)
	}
	var cfg map[string]interface{}
	_ = yaml.Unmarshal([]byte(out), &cfg)
	if cfg["hostname"] != "custom" {
		t.Fatalf("supplied hostname replaced: %v", cfg)
	}
	users := cfg["users"].([]interface{})
	if users[0] != "default" || users[1].(map[string]interface{})["name"] != "root" {
		t.Fatalf("default user and root expected: %v", users)
	}
}

func TestUserDataAddsPartToMultipart(t *testing.T) {
	in := strings.Join([]string{
		`Content-Type: multipart/mixed; boundary="==prgd-managed=="`,
		"MIME-Version: 1.0",
		"",
		"--==prgd-managed==",
		`Content-Type: text/cloud-config; charset="us-ascii"`,
		"",
		"#cloud-config",
		"packages: [nginx]",
		"--==prgd-managed==",
		`Content-Type: text/x-shellscript; charset="us-ascii"`,
		"",
		"#!/bin/sh",
		"echo managed",
		"--==prgd-managed==--",
		"",
	}, "\n")
	out, err := renderUserData(in, "web-1", testKeys)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Count(out, "--==prgd-managed==\n") != 3 || !strings.HasSuffix(out, "--==prgd-managed==--\n") {
		t.Fatalf("part not added inside the document: %s", out)
	}
	access := out[strings.LastIndex(out, "--==prgd-managed==\n"):]
	for _, want := range []string{"Content-Type: text/cloud-config", "Merge-Type: list(append)", "hostname: web-1", "ssh-ed25519 AAAA alice", "ssh_pwauth: false"} {
		if !strings.Contains(access, want) {
			t.Fatalf("access part lacks %q: %s", want, access)
		}
	}
	if !strings.Contains(out, "echo managed") {
		t.Fatal("original parts lost")
	}
}

func TestUserDataWrapsShellScript(t *testing.T) {
	out, err := renderUserData("#!/bin/bash\necho hi\n", "web-1", testKeys)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(out, "Content-Type: multipart/mixed") || !strings.Contains(out, "Content-Type: text/x-shellscript") || !strings.Contains(out, "echo hi") || !strings.Contains(out, "ssh-rsa BBBB bob") {
		t.Fatalf("script not wrapped with the access part: %s", out)
	}
}
