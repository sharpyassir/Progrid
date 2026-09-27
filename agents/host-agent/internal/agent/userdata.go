package agent

import (
	"fmt"
	"regexp"
	"strings"

	"gopkg.in/yaml.v3"
)

// Proxmox builds the cloud-init user-data from sshkeys, ciuser and the VM name, but a
// cicustom user snippet replaces that document entirely. Whenever we supply user-data, the
// access settings Proxmox would have written must therefore travel inside it.

// accessMergeType makes cloud-init append our lists (users) to the customer's and keep any
// key the customer already set (hostname, ssh_pwauth) when our part comes last.
const accessMergeType = "list(append)+dict(no_replace,recurse_list)+str()"

var reBoundary = regexp.MustCompile(`(?i)boundary="?([^";\r\n]+)"?`)

// accessConfig is the cloud-config that gives root the SSH keys and sets the hostname.
func accessConfig(hostname string, keys []string) map[string]interface{} {
	cfg := map[string]interface{}{"ssh_pwauth": false}
	if hostname != "" {
		cfg["hostname"] = hostname
		cfg["fqdn"] = hostname
	}
	if len(keys) > 0 {
		cfg["users"] = []interface{}{"default", rootUser(keys)}
		cfg["disable_root"] = false
	}
	return cfg
}

func rootUser(keys []string) map[string]interface{} {
	k := make([]interface{}, len(keys))
	for i, v := range keys {
		k[i] = v
	}
	return map[string]interface{}{"name": "root", "ssh_authorized_keys": k}
}

// renderUserData returns user-data that carries the hostname, the default user and the SSH
// keys next to what the customer (or the platform) supplied:
//   - a #cloud-config document is merged key by key; supplied keys win, users are appended;
//   - a MIME multipart document (the managed tier) gets one more cloud-config part;
//   - anything else (a shell script, #include, a jinja template) becomes a multipart
//     document with the original part and the cloud-config part.
func renderUserData(userData, hostname string, keys []string) (string, error) {
	trimmed := strings.TrimLeft(userData, " \t\r\n")
	if strings.HasPrefix(trimmed, "#cloud-config") {
		if out, err := mergeCloudConfig(trimmed, hostname, keys); err == nil {
			return out, nil
		}
		// Invalid YAML fails in cloud-init either way; still deliver the keys in their own part.
	}
	part, err := accessPart(hostname, keys)
	if err != nil {
		return "", err
	}
	if isMultipart(trimmed) {
		return appendPart(trimmed, part)
	}
	const boundary = "==pgcloud-access=="
	body := strings.TrimRight(userData, "\n") + "\n"
	ctype := "text/plain" // cloud-init detects the type from the first line
	if strings.HasPrefix(trimmed, "#!") {
		ctype = "text/x-shellscript"
	}
	return strings.Join([]string{
		`Content-Type: multipart/mixed; boundary="` + boundary + `"`,
		"MIME-Version: 1.0",
		"",
		"--" + boundary,
		`Content-Type: ` + ctype + `; charset="us-ascii"`,
		"MIME-Version: 1.0",
		"Content-Transfer-Encoding: 7bit",
		`Content-Disposition: attachment; filename="user-data"`,
		"",
		body,
		"--" + boundary,
		part,
		"--" + boundary + "--",
		"",
	}, "\n"), nil
}

func mergeCloudConfig(doc, hostname string, keys []string) (string, error) {
	cfg := map[string]interface{}{}
	if err := yaml.Unmarshal([]byte(doc), &cfg); err != nil {
		return "", err
	}
	if cfg == nil {
		cfg = map[string]interface{}{}
	}
	for k, v := range accessConfig(hostname, keys) {
		if k == "users" {
			continue
		}
		if _, set := cfg[k]; !set {
			cfg[k] = v
		}
	}
	if len(keys) > 0 {
		cfg["users"] = mergeUsers(cfg["users"], keys)
	}
	out, err := yaml.Marshal(cfg)
	if err != nil {
		return "", err
	}
	return "#cloud-config\n" + string(out), nil
}

// mergeUsers adds the keys to the supplied users list: to an existing root entry, or as a
// new root entry. Without a supplied list the result is the default user plus root.
func mergeUsers(existing interface{}, keys []string) []interface{} {
	list, ok := existing.([]interface{})
	if !ok || len(list) == 0 {
		return []interface{}{"default", rootUser(keys)}
	}
	for _, u := range list {
		m, ok := u.(map[string]interface{})
		if !ok || m["name"] != "root" {
			continue
		}
		have, _ := m["ssh_authorized_keys"].([]interface{})
		for _, k := range keys {
			have = append(have, k)
		}
		m["ssh_authorized_keys"] = have
		return list
	}
	return append(list, rootUser(keys))
}

// accessPart renders the cloud-config MIME part, headers included, without boundaries.
func accessPart(hostname string, keys []string) (string, error) {
	out, err := yaml.Marshal(accessConfig(hostname, keys))
	if err != nil {
		return "", err
	}
	return strings.Join([]string{
		`Content-Type: text/cloud-config; charset="us-ascii"`,
		"MIME-Version: 1.0",
		"Content-Transfer-Encoding: 7bit",
		`Content-Disposition: attachment; filename="pgcloud-access.yaml"`,
		"Merge-Type: " + accessMergeType,
		"",
		"#cloud-config",
		string(out),
	}, "\n"), nil
}

func isMultipart(doc string) bool {
	head, _, _ := strings.Cut(doc, "\n\n")
	return strings.Contains(strings.ToLower(head), "multipart/")
}

// appendPart inserts the part before the closing boundary so it is processed last.
func appendPart(doc, part string) (string, error) {
	head, _, _ := strings.Cut(doc, "\n\n")
	m := reBoundary.FindStringSubmatch(head)
	if m == nil {
		return "", fmt.Errorf("multipart user-data without a boundary")
	}
	closing := "--" + m[1] + "--"
	i := strings.LastIndex(doc, closing)
	if i < 0 {
		return "", fmt.Errorf("multipart user-data without a closing boundary")
	}
	return doc[:i] + "--" + m[1] + "\n" + part + "\n" + doc[i:], nil
}
