// pgcloud — the command-line client. One static binary, no dependencies, talks to the
// same public API as the console. Install: curl -fsSL https://get.pgcloud.example | sh
//
//	pgcloud login                       # email + password, or paste an API token
//	pgcloud servers create web-1 --size s-2vcpu-4gb --image ubuntu-24-04 --wait
//	pgcloud servers ls
//	pgcloud ssh web-1
//	pgcloud deploy https://github.com/you/app --branch main --port 3000
//	pgcloud deploys ls
//	pgcloud --json servers ls | jq .
package main

import (
	"bufio"
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"syscall"
	"text/tabwriter"
	"time"
)

var version = "dev"

type config struct {
	APIURL string `json:"api_url"`
	Token  string `json:"token"`
	Team   string `json:"team,omitempty"`
}

var (
	cfg      config
	jsonOut  bool
	project  string
	client   = &http.Client{Timeout: 60 * time.Second}
	stdout   = bufio.NewWriter(os.Stdout)
	exitCode = 0
)

func main() {
	defer stdout.Flush()
	args := parseGlobal(os.Args[1:])
	loadConfig()
	if len(args) == 0 {
		usage()
		return
	}
	cmd, rest := args[0], args[1:]
	var err error
	switch cmd {
	case "login":
		err = cmdLogin(rest)
	case "logout":
		err = os.Remove(configPath())
	case "whoami", "account":
		err = cmdGet("/v1/account", func(v map[string]any) {
			u, t := v["user"].(map[string]any), v["team"].(map[string]any)
			fmt.Fprintf(stdout, "%s (%s) — team %s [%s] — %s\n", u["email"], u["name"], t["name"], t["slug"], cfg.APIURL)
		})
	case "servers", "s":
		err = cmdServers(rest)
	case "ssh":
		err = cmdSSH(rest)
	case "deploy":
		err = cmdDeploy(rest)
	case "deploys", "d":
		err = cmdDeploys(rest)
	case "apps":
		err = cmdList("/v1/apps", nil, []string{"slug", "name", "category", "minSizeId", "version"})
	case "sizes":
		err = cmdList("/v1/sizes", nil, []string{"id", "vcpu", "memoryMb", "diskGb", "transferTb"})
	case "images":
		err = cmdList("/v1/images", nil, []string{"id", "kind", "name"})
	case "regions":
		err = cmdList("/v1/regions", nil, []string{"id", "name", "country"})
	case "pricing":
		err = cmdPricing(rest)
	case "ssh-keys", "keys":
		err = cmdSSHKeys(rest)
	case "approvals":
		err = cmdApprovals(rest)
	case "alerts":
		err = cmdAlerts(rest)
	case "volumes":
		err = cmdVolumes(rest)
	case "load-balancers", "lbs":
		err = cmdLoadBalancers(rest)
	case "certificates", "certs":
		err = cmdCertificates(rest)
	case "domains", "dns":
		err = cmdDomains(rest)
	case "buckets", "storage":
		err = cmdBuckets(rest)
	case "databases", "db":
		err = cmdDatabases(rest)
	case "support":
		err = cmdSupport(rest)
	case "kubernetes", "k8s":
		err = cmdKubernetes(rest)
	case "app":
		err = cmdApp(rest)
	case "tokens":
		err = cmdTokens(rest)
	case "firewalls":
		err = cmdList("/v1/firewalls", nil, []string{"id", "name"})
	case "billing":
		err = cmdBilling(rest)
	case "version":
		fmt.Fprintln(stdout, "pgcloud", version)
	case "help", "-h", "--help":
		usage()
	default:
		err = fmt.Errorf("unknown command %q (try `pgcloud help`)", cmd)
	}
	if err != nil {
		stdout.Flush()
		fmt.Fprintln(os.Stderr, "error:", err)
		os.Exit(1)
	}
}

func usage() {
	fmt.Fprint(stdout, `pgcloud — the developer cloud for Saudi Arabia, from your terminal

USAGE  pgcloud [--json] [--project SLUG] <command> [args]

ACCOUNT   login · logout · whoami · billing [invoices|payments|topup AMOUNT|pay INVOICE_ID] · tokens create NAME [--agent --cap 500] · ssh-keys ls|add NAME FILE
AGENTS    approvals [ls | approve ID | deny ID --reason TEXT]   (requests parked by agent tokens)
LBS       load-balancers [ls | create NAME --rule http:80:80 [--rule https:443:80:CERT_ID] [--server ID ...] [--tag T] [--nodes 2] [--wait] | get ID | add ID SERVER_ID | remove ID SERVER_ID | delete ID]
          certificates [ls | add NAME --le example.com,www.example.com | add NAME --cert FILE --key FILE | delete ID]
DATABASES databases [ls | create NAME --size S [--engine postgres] [--nodes 1|3] [--trusted CIDR,...] [--wait] | get ID | users ID [ls | add NAME | rm USER_ID] | dbs ID [ls | add NAME | rm DB_ID]
                     | trusted ID CIDR,... | backups ID [ls | now] | delete ID]
APPS      app [ls | create NAME REPO_URL [--branch B] [--port P] [--size app-xs] [--instances N] [--env K=V] [--git-token T] [--wait] | get ID | deploy ID | logs ID [--runtime] [--follow] | scale ID N | env ID K=V... | domains ID [add D | rm D] | stop ID | start ID | delete ID]
KUBERNETES kubernetes [ls | create NAME [--size S] [--count N] [--version V] [--ha] [--wait] | get ID | kubeconfig ID | pools ID [add NAME --size S --count N | scale POOL_ID N | rm POOL_ID] | delete ID]
STORAGE   buckets [ls | create NAME [--public] | get NAME | ls NAME [--prefix P] | upload NAME FILE [--key K] | download NAME KEY [--out FILE] | rm NAME KEY | public NAME on|off | delete NAME]
          buckets keys [ls | create NAME | revoke ID]
DNS       domains [ls | add NAME [--ip A.B.C.D] | get NAME | zone-file NAME | delete NAME]
          domains records NAME [ls | add TYPE HOST CONTENT [--ttl 300] [--priority 10] | delete RECORD_ID]
          domains rdns PUBLIC_IP_ID HOSTNAME|--clear
VOLUMES   volumes [ls | create NAME --size GB [--server ID] | attach ID SERVER_ID | detach ID | resize ID --size GB | delete ID]
MONITOR   servers metrics ID [--period 1h|6h|24h|7d|30d] · alerts [ls | incidents | create NAME --metric cpu --above 90 | mute ID | delete ID]
SERVERS   servers ls | create NAME [--size s-2vcpu-4gb] [--image ubuntu-24-04|wordpress | --snapshot SNAPSHOT_ID] [--key ID] [--wait]
                  | get ID | start|stop|reboot|delete ID | resize ID --size S | snapshot ID | restore ID SNAPSHOT_ID
                  | backups ID on|off | managed ID on|off|status | rename ID NAME
          ssh NAME|ID [-- command]
DEPLOY    deploy REPO_URL [--branch main] [--port 3000] [--size S] [--env K=V ...] [--name N] [--wait]
          deploys ls | get ID | redeploy ID | logs ID [--follow]
CATALOG   apps · sizes · images · regions · pricing [--currency SAR|USD] · firewalls

FLAGS     --json           machine-readable output
          --project SLUG   project (default "default")
ENV       PGCLOUD_TOKEN, PGCLOUD_API_URL override ~/.config/pgcloud/config.json
`)
}

/* ───────────────────────── config & http ───────────────────────── */

func configPath() string {
	if d := os.Getenv("XDG_CONFIG_HOME"); d != "" {
		return filepath.Join(d, "pgcloud", "config.json")
	}
	h, _ := os.UserHomeDir()
	return filepath.Join(h, ".config", "pgcloud", "config.json")
}

func loadConfig() {
	cfg.APIURL = "http://localhost:4000"
	if b, err := os.ReadFile(configPath()); err == nil {
		_ = json.Unmarshal(b, &cfg)
	}
	if v := os.Getenv("PGCLOUD_API_URL"); v != "" {
		cfg.APIURL = v
	}
	if v := os.Getenv("PGCLOUD_TOKEN"); v != "" {
		cfg.Token = v
	}
}

func saveConfig() error {
	if err := os.MkdirAll(filepath.Dir(configPath()), 0o700); err != nil {
		return err
	}
	b, _ := json.MarshalIndent(cfg, "", "  ")
	return os.WriteFile(configPath(), b, 0o600)
}

func parseGlobal(args []string) []string {
	var rest []string
	for i := 0; i < len(args); i++ {
		switch {
		case args[i] == "--json":
			jsonOut = true
		case args[i] == "--project" && i+1 < len(args):
			project = args[i+1]
			i++
		case strings.HasPrefix(args[i], "--project="):
			project = strings.TrimPrefix(args[i], "--project=")
		default:
			rest = append(rest, args[i])
		}
	}
	return rest
}

type apiError struct {
	Status  int
	Code    string
	Message string
	Details map[string]any
}

func (e *apiError) Error() string {
	if len(e.Details) > 0 {
		d, _ := json.Marshal(e.Details)
		return fmt.Sprintf("%s: %s %s", e.Code, e.Message, d)
	}
	return fmt.Sprintf("%s: %s", e.Code, e.Message)
}

// callText fetches a plain text endpoint (zone files) with the same auth as call.
func callText(method, path string, out *string) error {
	req, err := http.NewRequest(method, cfg.APIURL+path, nil)
	if err != nil {
		return err
	}
	req.Header.Set("User-Agent", "pgcloud-cli/"+version)
	if cfg.Token != "" {
		req.Header.Set("Authorization", "Bearer "+cfg.Token)
	}
	res, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("cannot reach %s: %w", cfg.APIURL, err)
	}
	defer res.Body.Close()
	raw, _ := io.ReadAll(res.Body)
	if res.StatusCode >= 400 {
		return fmt.Errorf("HTTP %d: %s", res.StatusCode, strings.TrimSpace(string(raw)))
	}
	*out = string(raw)
	return nil
}

func call(method, path string, body any, out any) error {
	var rdr io.Reader
	if body != nil {
		b, _ := json.Marshal(body)
		rdr = bytes.NewReader(b)
	}
	if project != "" && !strings.Contains(path, "project=") && (method == http.MethodGet) {
		sep := "?"
		if strings.Contains(path, "?") {
			sep = "&"
		}
		path += sep + "project=" + project
	}
	req, err := http.NewRequest(method, cfg.APIURL+path, rdr)
	if err != nil {
		return err
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("User-Agent", "pgcloud-cli/"+version)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Idempotency-Key", fmt.Sprintf("cli-%d", time.Now().UnixNano()))
	}
	if cfg.Token != "" {
		req.Header.Set("Authorization", "Bearer "+cfg.Token)
	}
	res, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("cannot reach %s: %w", cfg.APIURL, err)
	}
	defer res.Body.Close()
	raw, _ := io.ReadAll(res.Body)
	if res.StatusCode >= 400 {
		var env struct {
			Error apiError `json:"error"`
		}
		if json.Unmarshal(raw, &env) == nil && env.Error.Code != "" {
			env.Error.Status = res.StatusCode
			if res.StatusCode == 401 && !strings.HasPrefix(path, "/v1/auth/") {
				return errors.New("not logged in — run `pgcloud login`")
			}
			return &env.Error
		}
		return fmt.Errorf("HTTP %d: %s", res.StatusCode, strings.TrimSpace(string(raw)))
	}
	if out != nil && len(raw) > 0 {
		return json.Unmarshal(raw, out)
	}
	return nil
}

/* ───────────────────────── output ───────────────────────── */

func emit(v any) {
	enc := json.NewEncoder(stdout)
	enc.SetIndent("", "  ")
	_ = enc.Encode(v)
}

func table(rows []map[string]any, cols []string) {
	w := tabwriter.NewWriter(stdout, 0, 4, 2, ' ', 0)
	fmt.Fprintln(w, strings.ToUpper(strings.Join(cols, "\t")))
	for _, r := range rows {
		cells := make([]string, len(cols))
		for i, c := range cols {
			cells[i] = cell(dig(r, c))
		}
		fmt.Fprintln(w, strings.Join(cells, "\t"))
	}
	w.Flush()
}

// dig resolves "a.b.c" and "a[0].b" paths in a decoded JSON object.
func dig(v any, path string) any {
	for _, part := range strings.Split(path, ".") {
		idx := -1
		if i := strings.Index(part, "["); i >= 0 {
			fmt.Sscanf(part[i:], "[%d]", &idx)
			part = part[:i]
		}
		m, ok := v.(map[string]any)
		if !ok {
			return nil
		}
		v = m[part]
		if idx >= 0 {
			arr, ok := v.([]any)
			if !ok || idx >= len(arr) {
				return nil
			}
			v = arr[idx]
		}
	}
	return v
}

func cell(v any) string {
	switch t := v.(type) {
	case nil:
		return "—"
	case float64:
		if t == float64(int64(t)) {
			return fmt.Sprintf("%d", int64(t))
		}
		return fmt.Sprintf("%.2f", t)
	case []any:
		parts := make([]string, len(t))
		for i, x := range t {
			parts[i] = cell(x)
		}
		return strings.Join(parts, ",")
	case map[string]any:
		if id, ok := t["id"]; ok {
			return cell(id)
		}
		b, _ := json.Marshal(t)
		return string(b)
	default:
		return fmt.Sprint(t)
	}
}

func money(minor any, currency any) string {
	f, _ := minor.(float64)
	sym := map[string]string{"SAR": "SAR ", "USD": "$"}[fmt.Sprint(currency)]
	return fmt.Sprintf("%s%.2f", sym, f/100)
}

// hasFlag reports whether a boolean flag is present.
func hasFlag(args []string, name string) bool {
	for _, a := range args {
		if a == name {
			return true
		}
	}
	return false
}

// orEmpty renders a nullable JSON value without the word "<nil>".
func toList(v any) []any {
	if l, ok := v.([]any); ok {
		return l
	}
	return nil
}

func orEmpty(v any) string {
	if v == nil {
		return ""
	}
	return fmt.Sprint(v)
}

// printJSON writes a value as indented JSON to stdout.
func printJSON(v any) error {
	enc := json.NewEncoder(stdout)
	enc.SetIndent("", "  ")
	return enc.Encode(v)
}

func flag(args []string, name string) (string, []string) {
	for i := 0; i < len(args); i++ {
		if args[i] == name && i+1 < len(args) {
			return args[i+1], append(append([]string{}, args[:i]...), args[i+2:]...)
		}
		if strings.HasPrefix(args[i], name+"=") {
			return strings.TrimPrefix(args[i], name+"="), append(append([]string{}, args[:i]...), args[i+1:]...)
		}
	}
	return "", args
}

func has(args []string, name string) (bool, []string) {
	for i, a := range args {
		if a == name {
			return true, append(append([]string{}, args[:i]...), args[i+1:]...)
		}
	}
	return false, args
}

func multi(args []string, name string) ([]string, []string) {
	var vals []string
	for {
		v, rest := flag(args, name)
		if v == "" {
			return vals, rest
		}
		vals = append(vals, v)
		args = rest
	}
}

func prompt(label string, secret bool) string {
	fmt.Fprint(os.Stderr, label)
	if secret {
		if b, err := readPassword(); err == nil {
			fmt.Fprintln(os.Stderr)
			return strings.TrimSpace(string(b))
		}
	}
	s, _ := bufio.NewReader(os.Stdin).ReadString('\n')
	return strings.TrimSpace(s)
}

// readPassword disables echo on a POSIX terminal via stty; falls back to plain read.
func readPassword() ([]byte, error) {
	if fi, _ := os.Stdin.Stat(); fi.Mode()&os.ModeCharDevice == 0 {
		return nil, errors.New("not a tty")
	}
	_ = exec.Command("stty", "-F", "/dev/tty", "-echo").Run()
	defer exec.Command("stty", "-F", "/dev/tty", "echo").Run()
	s, err := bufio.NewReader(os.Stdin).ReadString('\n')
	return []byte(s), err
}

/* ───────────────────────── commands ───────────────────────── */

func cmdLogin(args []string) error {
	if u, rest := flag(args, "--api"); u != "" {
		cfg.APIURL = strings.TrimRight(u, "/")
		args = rest
	}
	if tok, _ := flag(args, "--token"); tok != "" {
		cfg.Token = tok
	} else {
		fmt.Fprintf(os.Stderr, "Sign in to %s (paste an API token as the email to use a token instead)\n", cfg.APIURL)
		email := prompt("Email or token: ", false)
		if strings.HasPrefix(email, "pgc_") {
			cfg.Token = email
		} else {
			pw := prompt("Password: ", true)
			var res struct {
				Session string `json:"session"`
				Team    struct {
					Slug string `json:"slug"`
				} `json:"team"`
			}
			cfg.Token = ""
			body := map[string]string{"email": email, "password": pw}
			for {
				err := call(http.MethodPost, "/v1/auth/login", body, &res)
				if err == nil {
					break
				}
				// Two factor: ask for the authenticator code and try once more.
				if ae, ok := err.(*apiError); ok && ae.Code == "totp_required" {
					body["totp"] = prompt("Authenticator code: ", false)
					continue
				}
				return err
			}
			cfg.Token, cfg.Team = res.Session, res.Team.Slug
		}
	}
	var me map[string]any
	if err := call(http.MethodGet, "/v1/account", nil, &me); err != nil {
		return err
	}
	if err := saveConfig(); err != nil {
		return err
	}
	t := me["team"].(map[string]any)
	fmt.Fprintf(stdout, "✓ logged in as %s — team %s — saved to %s\n", me["user"].(map[string]any)["email"], t["slug"], configPath())
	return nil
}

func cmdGet(path string, show func(map[string]any)) error {
	var v map[string]any
	if err := call(http.MethodGet, path, nil, &v); err != nil {
		return err
	}
	if jsonOut {
		emit(v)
	} else {
		show(v)
	}
	return nil
}

func cmdList(path string, filter func(map[string]any) bool, cols []string) error {
	var res struct {
		Data []map[string]any `json:"data"`
	}
	if err := call(http.MethodGet, path, nil, &res); err != nil {
		return err
	}
	rows := res.Data
	if filter != nil {
		rows = rows[:0]
		for _, r := range res.Data {
			if filter(r) {
				rows = append(rows, r)
			}
		}
	}
	if jsonOut {
		emit(rows)
	} else {
		table(rows, cols)
	}
	return nil
}

var serverCols = []string{"name", "status", "networks.v4[0].ipAddress", "size.id", "image.name", "region.id", "id"}

func cmdServers(args []string) error {
	if len(args) == 0 {
		args = []string{"ls"}
	}
	sub, rest := args[0], args[1:]
	switch sub {
	case "ls", "list":
		return cmdList("/v1/servers", nil, serverCols)
	case "create":
		if len(rest) == 0 {
			return errors.New("usage: servers create NAME [--size S] [--image I | --snapshot ID] [--key ID] [--user-data FILE] [--managed] [--wait]")
		}
		name := rest[0]
		size, rest := flag(rest[1:], "--size")
		image, rest := flag(rest, "--image")
		snapshot, rest := flag(rest, "--snapshot")
		keys, rest := multi(rest, "--key")
		userData, rest := flag(rest, "--user-data")
		managed, rest := has(rest, "--managed")
		wait, _ := has(rest, "--wait")
		body := map[string]any{"name": name, "size": or(size, "s-1vcpu-2gb")}
		if snapshot != "" {
			body["snapshotId"] = snapshot
		} else {
			body["image"] = or(image, "ubuntu-24-04")
		}
		if project != "" {
			body["project"] = project
		}
		if managed {
			body["managed"] = true
		}
		if len(keys) > 0 {
			body["sshKeys"] = keys
		} else if ids := defaultKeys(); len(ids) > 0 {
			body["sshKeys"] = ids
		}
		if userData != "" {
			b, err := os.ReadFile(userData)
			if err != nil {
				return err
			}
			body["userData"] = string(b)
		}
		var s map[string]any
		if err := call(http.MethodPost, "/v1/servers", body, &s); err != nil {
			return err
		}
		if wait {
			return waitServer(s["id"].(string))
		}
		if jsonOut {
			emit(s)
		} else {
			fmt.Fprintf(stdout, "✓ %s created (%s) — status %s. Watch with: pgcloud servers get %s\n", s["name"], s["id"], s["status"], s["id"])
		}
		return nil
	case "metrics":
		if len(args) < 2 {
			return errors.New("server id required")
		}
		period, _ := flag(args[2:], "--period")
		if period == "" {
			period = "1h"
		}
		var m struct {
			Resolution string           `json:"resolution"`
			Points     []map[string]any `json:"points"`
			Latest     map[string]any   `json:"latest"`
		}
		if err := call(http.MethodGet, "/v1/servers/"+args[1]+"/metrics?period="+period, nil, &m); err != nil {
			return err
		}
		if jsonOut {
			emit(m)
			return nil
		}
		if m.Latest == nil {
			fmt.Fprintln(stdout, "no samples yet")
			return nil
		}
		fmt.Fprintf(stdout, "%d points (%s)\n", len(m.Points), m.Resolution)
		for _, p := range m.Points {
			used, total := p["memoryUsedMb"].(float64), p["memoryTotalMb"].(float64)
			mem := 0.0
			if total > 0 {
				mem = used / total * 100
			}
			fmt.Fprintf(stdout, "%s  cpu %5.1f%%  mem %5.1f%%  net in %7.2f Mbps  out %7.2f Mbps\n", fmt.Sprint(p["at"])[11:16], p["cpu"], mem, p["netInBps"].(float64)*8/1e6, p["netOutBps"].(float64)*8/1e6)
		}
		return nil
	case "get":
		id, err := resolveServer(rest)
		if err != nil {
			return err
		}
		return cmdGet("/v1/servers/"+id, func(s map[string]any) { table([]map[string]any{s}, serverCols) })
	case "backups", "rename", "managed":
		if len(rest) < 2 {
			return errors.New("usage: pgcloud servers backups ID on|off | rename ID NAME | managed ID on|off|status")
		}
		if sub == "managed" && rest[1] == "status" {
			var st map[string]any
			if err := call(http.MethodGet, "/v1/servers/"+rest[0]+"/managed", nil, &st); err != nil {
				return err
			}
			if jsonOut {
				emit(st)
				return nil
			}
			fmt.Fprintf(stdout, "managed: %v  health: %v\n", st["managed"], orEmpty(st["health"]))
			for _, i := range toList(st["issues"]) {
				fmt.Fprintf(stdout, "  ! %v\n", i)
			}
			if r, ok := st["report"].(map[string]any); ok {
				fmt.Fprintf(stdout, "  disk %s%%  updates pending %s (security %s)  reboot required %v  failed units %d  last report %v\n", orEmpty(r["diskUsedPct"]), orEmpty(r["pendingUpdates"]), orEmpty(r["securityUpdates"]), r["rebootRequired"], len(toList(r["failedUnits"])), st["reportedAt"])
			}
			if c, _ := st["installCommand"].(string); c != "" {
				fmt.Fprintf(stdout, "  agent not reporting; install with:\n  %s\n", c)
			}
			return nil
		}
		body := map[string]any{}
		switch sub {
		case "backups":
			body["backups"] = rest[1] == "on"
		case "managed":
			body["managed"] = rest[1] == "on"
		default:
			body["name"] = rest[1]
		}
		var s map[string]any
		if err := call(http.MethodPatch, "/v1/servers/"+rest[0], body, &s); err != nil {
			return err
		}
		fmt.Fprintf(stdout, "✓ %v: backups=%v managed=%v\n", s["name"], s["backupsEnabled"], s["managed"])
		return nil
	case "start", "stop", "reboot", "snapshot", "resize", "rebuild":
		id, err := resolveServer(rest)
		if err != nil {
			return err
		}
		body := map[string]any{"type": sub}
		if v, _ := flag(rest, "--size"); v != "" {
			body["size"] = v
		}
		if v, _ := flag(rest, "--image"); v != "" {
			body["image"] = v
		}
		var a map[string]any
		if err := call(http.MethodPost, "/v1/servers/"+id+"/actions", body, &a); err != nil {
			return err
		}
		fmt.Fprintf(stdout, "✓ %s queued (action %s)\n", sub, a["id"])
		return nil
	case "restore":
		if len(rest) < 2 {
			return errors.New("usage: pgcloud servers restore ID SNAPSHOT_ID")
		}
		id, err := resolveServer(rest)
		if err != nil {
			return err
		}
		if y, _ := has(rest, "--yes"); !y && strings.ToLower(prompt(fmt.Sprintf("Roll server %s back to snapshot %s? Data written since is lost. [y/N] ", id, rest[1]), false)) != "y" {
			return errors.New("aborted")
		}
		var a map[string]any
		if err := call(http.MethodPost, "/v1/servers/"+id+"/restore", map[string]any{"snapshotId": rest[1]}, &a); err != nil {
			return err
		}
		fmt.Fprintf(stdout, "✓ restore queued (action %s)\n", a["id"])
		return nil
	case "delete", "rm":
		id, err := resolveServer(rest)
		if err != nil {
			return err
		}
		if y, _ := has(rest, "--yes"); !y && strings.ToLower(prompt(fmt.Sprintf("Delete server %s? [y/N] ", id), false)) != "y" {
			return errors.New("aborted")
		}
		if err := call(http.MethodDelete, "/v1/servers/"+id, nil, nil); err != nil {
			return err
		}
		fmt.Fprintln(stdout, "✓ delete queued")
		return nil
	}
	return fmt.Errorf("unknown servers subcommand %q", sub)
}

func or(a, b string) string {
	if a != "" {
		return a
	}
	return b
}

// resolveServer accepts an id or a name.
func resolveServer(args []string) (string, error) {
	if len(args) == 0 || strings.HasPrefix(args[0], "--") {
		return "", errors.New("server name or id required")
	}
	q := args[0]
	var res struct {
		Data []map[string]any `json:"data"`
	}
	if err := call(http.MethodGet, "/v1/servers", nil, &res); err != nil {
		return "", err
	}
	for _, s := range res.Data {
		if s["id"] == q || s["name"] == q {
			return s["id"].(string), nil
		}
	}
	return "", fmt.Errorf("no server named %q", q)
}

func defaultKeys() []string {
	var res struct {
		Data []map[string]any `json:"data"`
	}
	if call(http.MethodGet, "/v1/ssh-keys", nil, &res) != nil {
		return nil
	}
	var ids []string
	for _, k := range res.Data {
		ids = append(ids, k["id"].(string))
	}
	return ids
}

func waitServer(id string) error {
	start := time.Now()
	for {
		var s map[string]any
		if err := call(http.MethodGet, "/v1/servers/"+id, nil, &s); err != nil {
			return err
		}
		st := fmt.Sprint(s["status"])
		if !jsonOut {
			fmt.Fprintf(os.Stderr, "\r%-14s %3.0fs", st, time.Since(start).Seconds())
		}
		if st == "active" || st == "failed" || st == "off" {
			if !jsonOut {
				fmt.Fprintln(os.Stderr)
				ip := dig(s, "networks.v4[0].ipAddress")
				fmt.Fprintf(stdout, "✓ %s is %s — %v\n", s["name"], st, ip)
				if st == "active" && ip != nil {
					fmt.Fprintf(stdout, "  ssh root@%v\n", ip)
				}
			} else {
				emit(s)
			}
			if st == "failed" {
				return fmt.Errorf("provisioning failed: %v", s["statusMessage"])
			}
			return nil
		}
		time.Sleep(2 * time.Second)
	}
}

func cmdSSH(args []string) error {
	id, err := resolveServer(args)
	if err != nil {
		return err
	}
	var s map[string]any
	if err := call(http.MethodGet, "/v1/servers/"+id, nil, &s); err != nil {
		return err
	}
	ip := dig(s, "networks.v4[0].ipAddress")
	if ip == nil {
		return errors.New("server has no public IP yet")
	}
	ssh, err := exec.LookPath("ssh")
	if err != nil {
		return errors.New("ssh not found in PATH")
	}
	argv := []string{"ssh", "root@" + fmt.Sprint(ip)}
	if i := indexOf(args, "--"); i >= 0 {
		argv = append(argv, args[i+1:]...)
	}
	stdout.Flush()
	return syscall.Exec(ssh, argv, os.Environ())
}

func indexOf(a []string, s string) int {
	for i, x := range a {
		if x == s {
			return i
		}
	}
	return -1
}

var deployCols = []string{"name", "status", "url", "branch", "lastCommit", "id"}

func cmdDeploy(args []string) error {
	if len(args) == 0 || strings.HasPrefix(args[0], "--") {
		return errors.New("usage: pgcloud deploy https://github.com/you/app [--branch main] [--port 3000] [--size S] [--env K=V] [--name N] [--wait]")
	}
	repo := args[0]
	branch, rest := flag(args[1:], "--branch")
	port, rest := flag(rest, "--port")
	size, rest := flag(rest, "--size")
	name, rest := flag(rest, "--name")
	token, rest := flag(rest, "--git-token")
	envs, rest := multi(rest, "--env")
	wait, _ := has(rest, "--wait")
	body := map[string]any{"repoUrl": repo}
	if branch != "" {
		body["branch"] = branch
	}
	if port != "" {
		var p int
		fmt.Sscanf(port, "%d", &p)
		body["port"] = p
	}
	if size != "" {
		body["size"] = size
	}
	if name != "" {
		body["name"] = name
	}
	if token != "" {
		body["gitToken"] = token
	}
	if project != "" {
		body["project"] = project
	}
	if len(envs) > 0 {
		m := map[string]string{}
		for _, e := range envs {
			k, v, _ := strings.Cut(e, "=")
			m[k] = v
		}
		body["env"] = m
	}
	if ids := defaultKeys(); len(ids) > 0 {
		body["sshKeys"] = ids
	}
	var d map[string]any
	if err := call(http.MethodPost, "/v1/deploys", body, &d); err != nil {
		return err
	}
	if jsonOut {
		emit(d)
	} else {
		wh := d["webhook"].(map[string]any)
		fmt.Fprintf(stdout, "✓ deployment %s created (%s)\n\n", d["name"], d["id"])
		fmt.Fprintf(stdout, "Redeploy on every push — add this webhook in GitHub → Settings → Webhooks:\n  Payload URL:   %s\n  Content type:  application/json\n  Secret:        %s   (shown once)\n  Events:        push\n\n", wh["url"], wh["secret"])
	}
	if wait {
		if err := waitServer(d["serverId"].(string)); err != nil {
			return err
		}
		fmt.Fprintf(stdout, "→ building on the server; follow with: pgcloud deploys get %s\n", d["id"])
	}
	return nil
}

func cmdDeploys(args []string) error {
	if len(args) == 0 {
		args = []string{"ls"}
	}
	switch args[0] {
	case "ls", "list":
		return cmdList("/v1/deploys", nil, deployCols)
	case "get":
		if len(args) < 2 {
			return errors.New("deploy id required")
		}
		return cmdGet("/v1/deploys/"+args[1], func(d map[string]any) { table([]map[string]any{d}, deployCols) })
	case "redeploy":
		if len(args) < 2 {
			return errors.New("deploy id required")
		}
		var r map[string]any
		if err := call(http.MethodPost, "/v1/deploys/"+args[1]+"/redeploy", map[string]any{}, &r); err != nil {
			return err
		}
		fmt.Fprintln(stdout, "✓ redeploy triggered")
		return nil
	case "logs":
		if len(args) < 2 {
			return errors.New("deploy id required")
		}
		follow, _ := has(args[2:], "--follow")
		last := ""
		for {
			var l struct {
				Status string `json:"status"`
				Commit string `json:"commit"`
				Log    string `json:"log"`
			}
			if err := call(http.MethodGet, "/v1/deploys/"+args[1]+"/logs", nil, &l); err != nil {
				return err
			}
			if jsonOut {
				emit(l)
				return nil
			}
			if l.Log != last {
				fmt.Fprint(stdout, strings.TrimPrefix(l.Log, last))
				last = l.Log
			}
			if !follow || l.Status == "live" || l.Status == "failed" {
				if l.Log == "" {
					fmt.Fprintln(stdout, "(no build log yet)")
				}
				fmt.Fprintf(stdout, "\nstatus: %s\n", l.Status)
				return nil
			}
			stdout.Flush()
			time.Sleep(3 * time.Second)
		}
	}
	return fmt.Errorf("unknown deploys subcommand %q", args[0])
}

func cmdPricing(args []string) error {
	cur, _ := flag(args, "--currency")
	var res struct {
		Currency string           `json:"currency"`
		Data     []map[string]any `json:"data"`
	}
	if err := call(http.MethodGet, "/v1/pricing?currency="+or(cur, "SAR"), nil, &res); err != nil {
		return err
	}
	if jsonOut {
		emit(res)
		return nil
	}
	sort.Slice(res.Data, func(i, j int) bool {
		return res.Data[i]["monthlyMinor"].(float64) < res.Data[j]["monthlyMinor"].(float64)
	})
	w := tabwriter.NewWriter(stdout, 0, 4, 2, ' ', 0)
	fmt.Fprintln(w, "SKU\tMONTHLY\tHOURLY")
	for _, p := range res.Data {
		fmt.Fprintf(w, "%s\t%s\t%s\n", p["sku"], money(p["monthlyMinor"], res.Currency), money(p["hourlyMinor"], res.Currency))
	}
	w.Flush()
	return nil
}

func cmdSSHKeys(args []string) error {
	if len(args) == 0 || args[0] == "ls" {
		return cmdList("/v1/ssh-keys", nil, []string{"name", "fingerprint", "id"})
	}
	if args[0] == "add" {
		if len(args) < 3 {
			return errors.New("usage: ssh-keys add NAME ~/.ssh/id_ed25519.pub")
		}
		b, err := os.ReadFile(expand(args[2]))
		if err != nil {
			return err
		}
		var k map[string]any
		if err := call(http.MethodPost, "/v1/ssh-keys", map[string]string{"name": args[1], "publicKey": strings.TrimSpace(string(b))}, &k); err != nil {
			return err
		}
		fmt.Fprintf(stdout, "✓ added %s (%s)\n", k["name"], k["fingerprint"])
		return nil
	}
	return fmt.Errorf("unknown ssh-keys subcommand %q", args[0])
}

func expand(p string) string {
	if strings.HasPrefix(p, "~/") {
		h, _ := os.UserHomeDir()
		return filepath.Join(h, p[2:])
	}
	return p
}

func cmdBilling(args []string) error {
	if len(args) == 0 {
		return cmdGet("/v1/billing/balance", func(v map[string]any) {
			fmt.Fprintf(stdout, "currency: %s\ncredit: %s\nmonth to date: %s\nstatus: %s\n", v["currency"], money(v["creditMinor"], v["currency"]), money(v["monthToDateMinor"], v["currency"]), v["status"])
		})
	}
	switch args[0] {
	case "invoices":
		return cmdList("/v1/billing/invoices", nil, []string{"number", "periodStart", "status", "totalMinor", "currency", "id"})
	case "payments":
		return cmdList("/v1/billing/payments", nil, []string{"createdAt", "status", "amountMinor", "currency", "provider", "id"})
	case "topup", "pay":
		if len(args) < 2 {
			return fmt.Errorf("usage: pgcloud billing %s AMOUNT|INVOICE_ID", args[0])
		}
		var r map[string]any
		var err error
		if args[0] == "topup" {
			var f float64
			if _, e := fmt.Sscanf(args[1], "%f", &f); e != nil || f <= 0 {
				return errors.New("amount must be a number, e.g. 25")
			}
			err = call(http.MethodPost, "/v1/billing/topup", map[string]any{"amountMinor": int(f*100 + 0.5)}, &r)
		} else {
			err = call(http.MethodPost, "/v1/billing/invoices/"+args[1]+"/pay", map[string]any{}, &r)
		}
		if err != nil {
			return err
		}
		if jsonOut {
			emit(r)
			return nil
		}
		fmt.Fprintf(stdout, "Open this page to pay %s %s:\n%s\n", money(r["amountMinor"], r["currency"]), r["currency"], r["redirectUrl"])
		return nil
	}
	return errors.New("usage: pgcloud billing [invoices | payments | topup AMOUNT | pay INVOICE_ID]")
}

func cmdAlerts(args []string) error {
	if len(args) == 0 || args[0] == "ls" {
		return cmdList("/v1/alerts", nil, []string{"name", "metric", "comparator", "threshold", "windowMinutes", "enabled", "id"})
	}
	switch args[0] {
	case "incidents":
		return cmdList("/v1/alerts/incidents?open=true", nil, []string{"serverId", "value", "peakValue", "startedAt", "id"})
	case "create":
		// pgcloud alerts create NAME --metric cpu --above 90 [--minutes 10] [--server ID ...] [--tag T ...] [--email E ...]
		if len(args) < 2 {
			return errors.New("usage: pgcloud alerts create NAME --metric cpu|memory|disk|net_in|net_out --above N|--below N [--minutes 5] [--server ID] [--tag TAG] [--email ADDR]")
		}
		metric, rest := flag(args[2:], "--metric")
		above, rest := flag(rest, "--above")
		below, rest := flag(rest, "--below")
		minutes, rest := flag(rest, "--minutes")
		servers, rest := multi(rest, "--server")
		tags, rest := multi(rest, "--tag")
		emails, _ := multi(rest, "--email")
		body := map[string]any{"name": args[1], "metric": metric, "serverIds": servers, "tags": tags, "emails": emails}
		var thr float64
		if above != "" {
			fmt.Sscanf(above, "%f", &thr)
			body["comparator"], body["threshold"] = "above", thr
		} else if below != "" {
			fmt.Sscanf(below, "%f", &thr)
			body["comparator"], body["threshold"] = "below", thr
		} else {
			return errors.New("--above N or --below N is required")
		}
		if minutes != "" {
			var m int
			fmt.Sscanf(minutes, "%d", &m)
			body["windowMinutes"] = m
		}
		var a map[string]any
		if err := call(http.MethodPost, "/v1/alerts", body, &a); err != nil {
			return err
		}
		fmt.Fprintf(stdout, "✓ alert rule %s created (%s)\n", a["name"], a["id"])
		return nil
	case "mute", "enable":
		if len(args) < 2 {
			return errors.New("alert id required")
		}
		var a map[string]any
		if err := call(http.MethodPatch, "/v1/alerts/"+args[1], map[string]any{"enabled": args[0] == "enable"}, &a); err != nil {
			return err
		}
		fmt.Fprintf(stdout, "✓ %s: enabled=%v\n", a["name"], a["enabled"])
		return nil
	case "delete", "rm":
		if len(args) < 2 {
			return errors.New("alert id required")
		}
		if err := call(http.MethodDelete, "/v1/alerts/"+args[1], nil, nil); err != nil {
			return err
		}
		fmt.Fprintln(stdout, "✓ deleted")
		return nil
	}
	return errors.New("usage: pgcloud alerts [ls | incidents | create ... | mute ID | enable ID | delete ID]")
}

func cmdLoadBalancers(args []string) error {
	if len(args) == 0 || args[0] == "ls" {
		return cmdList("/v1/load-balancers", nil, []string{"name", "status", "ip", "nodes", "id"})
	}
	usage := errors.New("usage: pgcloud load-balancers [ls | create NAME --rule PROTO:ENTRY:TARGET[:CERT] ... [--server ID] [--tag T] [--nodes N] [--wait] | get ID | add ID SERVER_ID | remove ID SERVER_ID | delete ID]")
	var lb map[string]any
	switch args[0] {
	case "create":
		if len(args) < 2 {
			return usage
		}
		ruleSpecs, rest := multi(args[2:], "--rule")
		servers, rest := multi(rest, "--server")
		tag, rest := flag(rest, "--tag")
		nodes, rest := flag(rest, "--nodes")
		wait := hasFlag(rest, "--wait")
		if len(ruleSpecs) == 0 {
			ruleSpecs = []string{"http:80:80"}
		}
		rules := []map[string]any{}
		for _, spec := range ruleSpecs {
			parts := strings.Split(spec, ":")
			if len(parts) < 3 {
				return fmt.Errorf("rule %q: use PROTO:ENTRY_PORT:TARGET_PORT[:CERT_ID], for example http:80:8080 or https:443:8080:cert_id", spec)
			}
			var entry, target int
			fmt.Sscanf(parts[1], "%d", &entry)
			fmt.Sscanf(parts[2], "%d", &target)
			r := map[string]any{"entryProtocol": parts[0], "entryPort": entry, "targetPort": target, "targetProtocol": "http"}
			if parts[0] == "tcp" {
				r["targetProtocol"] = "tcp"
			}
			if len(parts) > 3 {
				r["certificateId"] = parts[3]
			}
			rules = append(rules, r)
		}
		body := map[string]any{"name": args[1], "forwardingRules": rules, "serverIds": servers}
		if tag != "" {
			body["tag"] = tag
		}
		if nodes != "" {
			var n int
			fmt.Sscanf(nodes, "%d", &n)
			body["nodes"] = n
		}
		if err := call(http.MethodPost, "/v1/load-balancers", body, &lb); err != nil {
			return err
		}
		fmt.Fprintf(stdout, "✓ load balancer %s is being created at %v (%s)\n", lb["name"], lb["ip"], lb["id"])
		if wait {
			id := lb["id"].(string)
			for i := 0; i < 300; i++ {
				time.Sleep(3 * time.Second)
				if err := call(http.MethodGet, "/v1/load-balancers/"+id, nil, &lb); err != nil {
					return err
				}
				if lb["status"] == "active" || lb["status"] == "failed" {
					break
				}
			}
			fmt.Fprintf(stdout, "  status: %v %v\n", lb["status"], orEmpty(lb["statusMessage"]))
		}
	case "get":
		if len(args) < 2 {
			return usage
		}
		if err := call(http.MethodGet, "/v1/load-balancers/"+args[1], nil, &lb); err != nil {
			return err
		}
		if jsonOut {
			return printJSON(lb)
		}
		fmt.Fprintf(stdout, "%s  %v  ip=%v  nodes=%v  algorithm=%v  version=%v\n", lb["name"], lb["status"], lb["ip"], lb["nodes"], lb["algorithm"], lb["configVersion"])
		if rules, ok := lb["forwardingRules"].([]any); ok {
			for _, r := range rules {
				m := r.(map[string]any)
				fmt.Fprintf(stdout, "  rule  %v:%v -> %v:%v\n", m["entryProtocol"], m["entryPort"], m["targetProtocol"], m["targetPort"])
			}
		}
		if targets, ok := lb["targets"].([]any); ok {
			for _, t := range targets {
				m := t.(map[string]any)
				health := "unknown"
				if h, ok := m["healthy"].(bool); ok {
					health = map[bool]string{true: "healthy", false: "unhealthy"}[h]
				}
				fmt.Fprintf(stdout, "  target  %v  %v  %s\n", m["name"], m["status"], health)
			}
		}
	case "add", "remove", "rm":
		if len(args) < 3 {
			return usage
		}
		if args[0] == "add" {
			if err := call(http.MethodPost, "/v1/load-balancers/"+args[1]+"/servers", map[string]any{"serverIds": args[2:]}, &lb); err != nil {
				return err
			}
		} else if err := call(http.MethodDelete, "/v1/load-balancers/"+args[1]+"/servers/"+args[2], nil, &lb); err != nil {
			return err
		}
		fmt.Fprintf(stdout, "✓ %s now has %d target(s); config v%v is rolling out\n", lb["name"], len(lb["targets"].([]any)), lb["configVersion"])
	case "delete":
		if len(args) < 2 {
			return usage
		}
		if err := call(http.MethodDelete, "/v1/load-balancers/"+args[1], nil, nil); err != nil {
			return err
		}
		fmt.Fprintln(stdout, "✓ deleting")
	default:
		return usage
	}
	return nil
}

func cmdCertificates(args []string) error {
	if len(args) == 0 || args[0] == "ls" {
		return cmdList("/v1/certificates", nil, []string{"name", "type", "domains", "notAfter", "id"})
	}
	switch args[0] {
	case "add":
		if len(args) < 2 {
			return errors.New("usage: pgcloud certificates add NAME --le DOMAIN[,DOMAIN] | add NAME --cert FILE --key FILE")
		}
		le, rest := flag(args[2:], "--le")
		certFile, rest := flag(rest, "--cert")
		keyFile, _ := flag(rest, "--key")
		body := map[string]any{"name": args[1]}
		if le != "" {
			body["type"], body["domains"] = "letsencrypt", strings.Split(le, ",")
		} else if certFile != "" && keyFile != "" {
			c, err := os.ReadFile(certFile)
			if err != nil {
				return err
			}
			k, err := os.ReadFile(keyFile)
			if err != nil {
				return err
			}
			body["type"], body["certPem"], body["keyPem"] = "custom", string(c), string(k)
		} else {
			return errors.New("give --le DOMAINS or --cert FILE --key FILE")
		}
		var c map[string]any
		if err := call(http.MethodPost, "/v1/certificates", body, &c); err != nil {
			return err
		}
		fmt.Fprintf(stdout, "✓ certificate %s (%v) added: %s\n", c["name"], c["type"], c["id"])
		return nil
	case "delete", "rm":
		if len(args) < 2 {
			return errors.New("certificate id required")
		}
		if err := call(http.MethodDelete, "/v1/certificates/"+args[1], nil, nil); err != nil {
			return err
		}
		fmt.Fprintln(stdout, "✓ deleted")
		return nil
	}
	return errors.New("usage: pgcloud certificates [ls | add ... | delete ID]")
}

func cmdDatabases(args []string) error {
	if len(args) == 0 || args[0] == "ls" {
		return cmdList("/v1/databases", nil, []string{"name", "engine", "status", "nodes", "id"})
	}
	usage := errors.New("usage: pgcloud databases [ls | create NAME --size S [--engine postgres] [--nodes 1|3] [--trusted CIDRS] [--wait] | get ID | users ID ... | dbs ID ... | trusted ID CIDRS | backups ID [ls|now] | delete ID]")
	var c map[string]any
	switch args[0] {
	case "create":
		if len(args) < 2 {
			return usage
		}
		size, rest := flag(args[2:], "--size")
		engine, rest := flag(rest, "--engine")
		nodes, rest := flag(rest, "--nodes")
		trusted, rest := flag(rest, "--trusted")
		wait := hasFlag(rest, "--wait")
		if size == "" {
			return errors.New("--size is required (a server size with at least 1 GB of memory)")
		}
		body := map[string]any{"name": args[1], "engine": or(engine, "postgres"), "size": size}
		if nodes != "" {
			var n int
			fmt.Sscanf(nodes, "%d", &n)
			body["nodes"] = n
		}
		if trusted != "" {
			body["trustedSources"] = strings.Split(trusted, ",")
		}
		if err := call(http.MethodPost, "/v1/databases", body, &c); err != nil {
			return err
		}
		fmt.Fprintf(stdout, "✓ database %s is being created (%s)\n", c["name"], c["id"])
		if wait {
			id := c["id"].(string)
			for i := 0; i < 300; i++ {
				time.Sleep(5 * time.Second)
				if err := call(http.MethodGet, "/v1/databases/"+id, nil, &c); err != nil {
					return err
				}
				if c["status"] == "active" || c["status"] == "failed" {
					break
				}
			}
			fmt.Fprintf(stdout, "  status: %v %v\n", c["status"], orEmpty(c["statusMessage"]))
			if conn, ok := c["connection"].(map[string]any); ok && c["status"] == "active" {
				fmt.Fprintf(stdout, "  %v\n", conn["uri"])
			}
		}
	case "get":
		if len(args) < 2 {
			return usage
		}
		if err := call(http.MethodGet, "/v1/databases/"+args[1], nil, &c); err != nil {
			return err
		}
		if jsonOut {
			return printJSON(c)
		}
		conn, _ := c["connection"].(map[string]any)
		fmt.Fprintf(stdout, "%s  %v %v  %v  nodes=%v  config v%v\n", c["name"], c["engine"], c["version"], c["status"], c["nodes"], c["configVersion"])
		fmt.Fprintf(stdout, "  host %v (private %v) port %v pooler %v\n  admin %v / %v\n  uri %v\n", conn["host"], conn["privateHost"], conn["port"], orEmpty(c["poolerPort"]), conn["user"], conn["password"], conn["uri"])
		if ns, ok := c["nodeStatus"].([]any); ok {
			for _, n := range ns {
				m := n.(map[string]any)
				fmt.Fprintf(stdout, "  node %v  %v  %v\n", m["index"], m["status"], m["role"])
			}
		}
	case "users", "dbs":
		if len(args) < 2 {
			return usage
		}
		kind := args[0]
		if len(args) < 3 || args[2] == "ls" {
			if err := call(http.MethodGet, "/v1/databases/"+args[1], nil, &c); err != nil {
				return err
			}
			rows := []map[string]any{}
			for _, u := range c[map[string]string{"users": "users", "dbs": "databases"}[kind]].([]any) {
				rows = append(rows, u.(map[string]any))
			}
			table(rows, []string{"name", "id"})
			return nil
		}
		switch args[2] {
		case "add":
			if len(args) < 4 {
				return usage
			}
			var r map[string]any
			if err := call(http.MethodPost, "/v1/databases/"+args[1]+"/"+kind, map[string]any{"name": args[3]}, &r); err != nil {
				return err
			}
			if kind == "users" {
				fmt.Fprintf(stdout, "✓ user %v created, password (shown once): %v\n", r["name"], r["password"])
			} else {
				fmt.Fprintf(stdout, "✓ database %v created\n", r["name"])
			}
		case "rm", "delete":
			if len(args) < 4 {
				return usage
			}
			if err := call(http.MethodDelete, "/v1/databases/"+args[1]+"/"+kind+"/"+args[3], nil, nil); err != nil {
				return err
			}
			fmt.Fprintln(stdout, "✓ deleted")
		default:
			return usage
		}
	case "trusted":
		if len(args) < 3 {
			return usage
		}
		list := []string{}
		if args[2] != "none" {
			list = strings.Split(args[2], ",")
		}
		if err := call(http.MethodPatch, "/v1/databases/"+args[1], map[string]any{"trustedSources": list}, &c); err != nil {
			return err
		}
		fmt.Fprintf(stdout, "✓ trusted sources: %v\n", c["trustedSources"])
	case "backups":
		if len(args) < 2 {
			return usage
		}
		if len(args) > 2 && args[2] == "now" {
			var r map[string]any
			if err := call(http.MethodPost, "/v1/databases/"+args[1]+"/backups", map[string]any{}, &r); err != nil {
				return err
			}
			fmt.Fprintf(stdout, "✓ backup %v started\n", r["id"])
			return nil
		}
		return cmdList("/v1/databases/"+args[1]+"/backups", nil, []string{"label", "kind", "status", "sizeBytes", "startedAt"})
	case "delete":
		if len(args) < 2 {
			return usage
		}
		if err := call(http.MethodDelete, "/v1/databases/"+args[1], nil, nil); err != nil {
			return err
		}
		fmt.Fprintln(stdout, "✓ deleting")
	default:
		return usage
	}
	return nil
}

func cmdBuckets(args []string) error {
	if len(args) == 0 || (args[0] == "ls" && len(args) == 1) {
		var out map[string]any
		if err := call(http.MethodGet, "/v1/buckets", nil, &out); err != nil {
			return err
		}
		if jsonOut {
			return printJSON(out)
		}
		rows := []map[string]any{}
		for _, b := range out["data"].([]any) {
			rows = append(rows, b.(map[string]any))
		}
		table(rows, []string{"name", "status", "public", "sizeBytes", "objectCount", "id"})
		fmt.Fprintf(stdout, "endpoint: %v  region: %v\n", out["endpoint"], out["region"])
		return nil
	}
	usage := errors.New("usage: pgcloud buckets [ls | create NAME [--public] | get NAME | ls NAME [--prefix P] | upload NAME FILE [--key K] | download NAME KEY [--out FILE] | rm NAME KEY | public NAME on|off | delete NAME | keys ...]")
	var b map[string]any
	switch args[0] {
	case "create":
		if len(args) < 2 {
			return usage
		}
		if err := call(http.MethodPost, "/v1/buckets", map[string]any{"name": args[1], "public": hasFlag(args[2:], "--public")}, &b); err != nil {
			return err
		}
		fmt.Fprintf(stdout, "✓ bucket %s created at %v\n", b["name"], b["url"])
	case "get":
		if len(args) < 2 {
			return usage
		}
		if err := call(http.MethodGet, "/v1/buckets/"+args[1], nil, &b); err != nil {
			return err
		}
		return printJSON(b)
	case "ls":
		prefix, _ := flag(args[2:], "--prefix")
		var l map[string]any
		if err := call(http.MethodGet, "/v1/buckets/"+args[1]+"/objects?prefix="+url.QueryEscape(prefix), nil, &l); err != nil {
			return err
		}
		if jsonOut {
			return printJSON(l)
		}
		for _, p := range l["prefixes"].([]any) {
			fmt.Fprintf(stdout, "%-12s %s\n", "(prefix)", p)
		}
		for _, o := range l["objects"].([]any) {
			m := o.(map[string]any)
			fmt.Fprintf(stdout, "%12.0f %s  %s\n", m["size"], m["lastModified"], m["key"])
		}
	case "upload":
		if len(args) < 3 {
			return usage
		}
		key, _ := flag(args[3:], "--key")
		if key == "" {
			key = filepath.Base(args[2])
		}
		data, err := os.ReadFile(args[2])
		if err != nil {
			return err
		}
		var p map[string]any
		if err := call(http.MethodPost, "/v1/buckets/"+args[1]+"/presign", map[string]any{"key": key, "method": "PUT", "contentType": "application/octet-stream"}, &p); err != nil {
			return err
		}
		req, _ := http.NewRequest(http.MethodPut, p["url"].(string), bytes.NewReader(data))
		req.Header.Set("Content-Type", "application/octet-stream")
		res, err := client.Do(req)
		if err != nil {
			return err
		}
		res.Body.Close()
		if res.StatusCode >= 300 {
			return fmt.Errorf("upload failed: HTTP %d", res.StatusCode)
		}
		fmt.Fprintf(stdout, "✓ %s uploaded to %s/%s (%d bytes)\n", args[2], args[1], key, len(data))
	case "download":
		if len(args) < 3 {
			return usage
		}
		out, _ := flag(args[3:], "--out")
		if out == "" {
			out = filepath.Base(args[2])
		}
		var p map[string]any
		if err := call(http.MethodPost, "/v1/buckets/"+args[1]+"/presign", map[string]any{"key": args[2], "method": "GET"}, &p); err != nil {
			return err
		}
		res, err := client.Get(p["url"].(string))
		if err != nil {
			return err
		}
		defer res.Body.Close()
		if res.StatusCode >= 300 {
			return fmt.Errorf("download failed: HTTP %d", res.StatusCode)
		}
		f, err := os.Create(out)
		if err != nil {
			return err
		}
		n, err := io.Copy(f, res.Body)
		f.Close()
		if err != nil {
			return err
		}
		fmt.Fprintf(stdout, "✓ %s/%s -> %s (%d bytes)\n", args[1], args[2], out, n)
	case "rm":
		if len(args) < 3 {
			return usage
		}
		if err := call(http.MethodDelete, "/v1/buckets/"+args[1]+"/objects?key="+url.QueryEscape(args[2]), nil, nil); err != nil {
			return err
		}
		fmt.Fprintln(stdout, "✓ deleted")
	case "public":
		if len(args) < 3 {
			return usage
		}
		if err := call(http.MethodPatch, "/v1/buckets/"+args[1], map[string]any{"public": args[2] == "on"}, &b); err != nil {
			return err
		}
		fmt.Fprintf(stdout, "✓ %s public=%v\n", b["name"], b["public"])
	case "delete":
		if len(args) < 2 {
			return usage
		}
		if err := call(http.MethodDelete, "/v1/buckets/"+args[1], nil, nil); err != nil {
			return err
		}
		fmt.Fprintln(stdout, "✓ deleted")
	case "keys":
		if len(args) < 2 || args[1] == "ls" {
			return cmdList("/v1/storage-keys", nil, []string{"name", "accessKey", "createdAt", "id"})
		}
		switch args[1] {
		case "create":
			if len(args) < 3 {
				return errors.New("usage: pgcloud buckets keys create NAME")
			}
			var k map[string]any
			if err := call(http.MethodPost, "/v1/storage-keys", map[string]any{"name": args[2]}, &k); err != nil {
				return err
			}
			fmt.Fprintf(stdout, "✓ key %s created. The secret is shown once:\nAWS_ACCESS_KEY_ID=%v\nAWS_SECRET_ACCESS_KEY=%v\nAWS_ENDPOINT_URL=%v\nAWS_DEFAULT_REGION=%v\n", k["name"], k["accessKey"], k["secretKey"], k["endpoint"], k["region"])
		case "revoke", "rm":
			if len(args) < 3 {
				return errors.New("key id required")
			}
			if err := call(http.MethodDelete, "/v1/storage-keys/"+args[2], nil, nil); err != nil {
				return err
			}
			fmt.Fprintln(stdout, "✓ revoked")
		default:
			return errors.New("usage: pgcloud buckets keys [ls | create NAME | revoke ID]")
		}
	default:
		return usage
	}
	return nil
}

func cmdDomains(args []string) error {
	if len(args) == 0 || args[0] == "ls" {
		var out map[string]any
		if err := call(http.MethodGet, "/v1/domains", nil, &out); err != nil {
			return err
		}
		if jsonOut {
			return printJSON(out)
		}
		rows := []map[string]any{}
		for _, z := range out["data"].([]any) {
			rows = append(rows, z.(map[string]any))
		}
		table(rows, []string{"name", "status", "synced", "recordCount", "id"})
		fmt.Fprintf(stdout, "nameservers: %v\n", out["nameservers"])
		return nil
	}
	usage := errors.New("usage: pgcloud domains [ls | add NAME [--ip IP] | get NAME | zone-file NAME | delete NAME | records NAME ... | rdns IP_ID HOSTNAME|--clear]")
	var z map[string]any
	switch args[0] {
	case "add":
		if len(args) < 2 {
			return usage
		}
		ip, _ := flag(args[2:], "--ip")
		body := map[string]any{"name": args[1]}
		if ip != "" {
			body["ip"] = ip
		}
		if err := call(http.MethodPost, "/v1/domains", body, &z); err != nil {
			return err
		}
		fmt.Fprintf(stdout, "✓ %s added; set its nameservers to %v\n", z["name"], z["nameservers"])
	case "get":
		if len(args) < 2 {
			return usage
		}
		if err := call(http.MethodGet, "/v1/domains/"+args[1], nil, &z); err != nil {
			return err
		}
		if jsonOut {
			return printJSON(z)
		}
		fmt.Fprintf(stdout, "%s  %v  serial=%v  synced=%v\n", z["name"], z["status"], z["serial"], z["synced"])
		rows := []map[string]any{}
		for _, r := range z["records"].([]any) {
			rows = append(rows, r.(map[string]any))
		}
		table(rows, []string{"type", "name", "priority", "content", "ttl", "id"})
	case "zone-file":
		if len(args) < 2 {
			return usage
		}
		var text string
		if err := callText(http.MethodGet, "/v1/domains/"+args[1]+"/zone-file", &text); err != nil {
			return err
		}
		fmt.Fprint(stdout, text)
	case "delete", "rm":
		if len(args) < 2 {
			return usage
		}
		if err := call(http.MethodDelete, "/v1/domains/"+args[1], nil, nil); err != nil {
			return err
		}
		fmt.Fprintln(stdout, "✓ deleted")
	case "records":
		if len(args) < 3 {
			return errors.New("usage: pgcloud domains records NAME [ls | add TYPE HOST CONTENT [--ttl N] [--priority N] | delete RECORD_ID]")
		}
		zone := args[1]
		switch args[2] {
		case "ls":
			return cmdDomains([]string{"get", zone})
		case "add":
			if len(args) < 6 {
				return errors.New("usage: pgcloud domains records NAME add TYPE HOST CONTENT [--ttl N] [--priority N]")
			}
			ttl, rest := flag(args[6:], "--ttl")
			prio, _ := flag(rest, "--priority")
			body := map[string]any{"type": strings.ToUpper(args[3]), "name": args[4], "content": args[5]}
			if ttl != "" {
				var n int
				fmt.Sscanf(ttl, "%d", &n)
				body["ttl"] = n
			}
			if prio != "" {
				var n int
				fmt.Sscanf(prio, "%d", &n)
				body["priority"] = n
			}
			var r map[string]any
			if err := call(http.MethodPost, "/v1/domains/"+zone+"/records", body, &r); err != nil {
				return err
			}
			fmt.Fprintf(stdout, "✓ %v %v -> %v (%v)\n", r["type"], r["name"], r["content"], r["id"])
		case "delete", "rm":
			if len(args) < 4 {
				return errors.New("record id required")
			}
			if err := call(http.MethodDelete, "/v1/domains/"+zone+"/records/"+args[3], nil, nil); err != nil {
				return err
			}
			fmt.Fprintln(stdout, "✓ deleted")
		default:
			return errors.New("usage: pgcloud domains records NAME [ls | add ... | delete RECORD_ID]")
		}
	case "rdns":
		if len(args) < 3 {
			return errors.New("usage: pgcloud domains rdns PUBLIC_IP_ID HOSTNAME|--clear")
		}
		body := map[string]any{"name": nil}
		if args[2] != "--clear" {
			body["name"] = args[2]
		}
		var r map[string]any
		if err := call(http.MethodPut, "/v1/public-ips/"+args[1]+"/reverse-dns", body, &r); err != nil {
			return err
		}
		fmt.Fprintf(stdout, "✓ %v -> %v\n", r["address"], orEmpty(r["reverseDns"]))
	default:
		return usage
	}
	return nil
}

func cmdVolumes(args []string) error {
	if len(args) == 0 || args[0] == "ls" {
		return cmdList("/v1/volumes", nil, []string{"name", "sizeGb", "status", "serverId", "device", "id"})
	}
	need := func(n int, usage string) error {
		if len(args) < n {
			return errors.New("usage: pgcloud volumes " + usage)
		}
		return nil
	}
	sizeOf := func(rest []string) (int, []string) {
		s, rest := flag(rest, "--size")
		var gb int
		fmt.Sscanf(strings.TrimSuffix(strings.TrimSuffix(s, "GB"), "G"), "%d", &gb)
		return gb, rest
	}
	var v map[string]any
	switch args[0] {
	case "create":
		if err := need(2, "create NAME --size GB [--server ID]"); err != nil {
			return err
		}
		gb, rest := sizeOf(args[2:])
		if gb <= 0 {
			return errors.New("--size GB is required (10 to 16384)")
		}
		srv, _ := flag(rest, "--server")
		body := map[string]any{"name": args[1], "sizeGb": gb}
		if srv != "" {
			body["serverId"] = srv
		}
		if err := call(http.MethodPost, "/v1/volumes", body, &v); err != nil {
			return err
		}
		fmt.Fprintf(stdout, "✓ volume %s (%v GB) is being created (%s)\n", v["name"], v["sizeGb"], v["id"])
	case "attach":
		if err := need(3, "attach VOLUME_ID SERVER_ID"); err != nil {
			return err
		}
		if err := call(http.MethodPost, "/v1/volumes/"+args[1]+"/attach", map[string]any{"serverId": args[2]}, &v); err != nil {
			return err
		}
		fmt.Fprintf(stdout, "✓ attaching %s to %s; the disk appears under /dev/disk/by-id in a few seconds\n", v["name"], args[2])
	case "detach":
		if err := need(2, "detach VOLUME_ID"); err != nil {
			return err
		}
		if err := call(http.MethodPost, "/v1/volumes/"+args[1]+"/detach", map[string]any{}, &v); err != nil {
			return err
		}
		fmt.Fprintf(stdout, "✓ detaching %s (unmount it in the guest first)\n", v["name"])
	case "resize":
		if err := need(2, "resize VOLUME_ID --size GB"); err != nil {
			return err
		}
		gb, _ := sizeOf(args[2:])
		if gb <= 0 {
			return errors.New("--size GB is required")
		}
		if err := call(http.MethodPost, "/v1/volumes/"+args[1]+"/resize", map[string]any{"sizeGb": gb}, &v); err != nil {
			return err
		}
		fmt.Fprintf(stdout, "✓ growing %s to %d GB; extend the file system in the guest afterwards\n", v["name"], gb)
	case "delete", "rm":
		if err := need(2, "delete VOLUME_ID"); err != nil {
			return err
		}
		if err := call(http.MethodDelete, "/v1/volumes/"+args[1], nil, nil); err != nil {
			return err
		}
		fmt.Fprintln(stdout, "✓ deleting")
	default:
		return errors.New("usage: pgcloud volumes [ls | create NAME --size GB [--server ID] | attach ID SERVER_ID | detach ID | resize ID --size GB | delete ID]")
	}
	return nil
}

func cmdApprovals(args []string) error {
	if len(args) == 0 || args[0] == "ls" {
		return cmdList("/v1/approvals?status=pending", nil, []string{"summary", "kind", "status", "expiresAt", "id"})
	}
	if (args[0] == "approve" || args[0] == "deny") && len(args) >= 2 {
		body := map[string]any{}
		if args[0] == "deny" {
			if reason, _ := flag(args[2:], "--reason"); reason != "" {
				body["reason"] = reason
			}
		}
		var a map[string]any
		if err := call(http.MethodPost, "/v1/approvals/"+args[1]+"/"+args[0], body, &a); err != nil {
			return err
		}
		fmt.Fprintf(stdout, "✓ %s: %s\n", a["status"], a["summary"])
		return nil
	}
	return errors.New("usage: pgcloud approvals [ls | approve ID | deny ID --reason TEXT]")
}

func cmdTokens(args []string) error {
	if len(args) == 0 || args[0] == "ls" {
		return cmdList("/v1/tokens", nil, []string{"name", "prefix", "isAgent", "spendCapMinor", "scopes", "id"})
	}
	if args[0] == "create" && len(args) >= 2 {
		agent, rest := has(args[2:], "--agent")
		cap, rest := flag(rest, "--cap")
		scopes, rest := multi(rest, "--scope")
		if len(scopes) == 0 {
			scopes = []string{"servers:read", "servers:write", "apps:read", "network:read"}
		}
		body := map[string]any{"name": args[1], "scopes": scopes, "isAgent": agent}
		if cap != "" {
			var f float64
			fmt.Sscanf(cap, "%f", &f)
			body["spendCapMinor"] = int(f * 100)
			body["requireApprovalFor"] = []string{"servers:delete", "servers:resize-down"}
		}
		var t map[string]any
		if err := call(http.MethodPost, "/v1/tokens", body, &t); err != nil {
			return err
		}
		fmt.Fprintf(stdout, "✓ token %s created — copy it now, it is shown once:\n%s\n", args[1], t["token"])
		if agent {
			fmt.Fprintf(stdout, "\nAdd to Claude Code:  claude mcp add pgcloud -e PGCLOUD_TOKEN=%s -- npx -y pgcloud-mcp\n", t["token"])
		}
		return nil
	}
	if args[0] == "revoke" && len(args) >= 2 {
		return call(http.MethodDelete, "/v1/tokens/"+args[1], nil, nil)
	}
	return errors.New("usage: tokens ls | create NAME [--agent --cap 500 --scope S...] | revoke ID")
}

// cmdSupport: support plan and tickets.
func cmdSupport(args []string) error {
	usage := errors.New("usage: pgcloud support [plan [free|developer|standard|premium] | plans | tickets [--status open|closed|all] | new SUBJECT --body TEXT [--priority P] [--about server:ID] | show ID | reply ID TEXT | close ID]")
	if len(args) == 0 {
		args = []string{"plan"}
	}
	var out map[string]any
	switch args[0] {
	case "plans":
		var r struct {
			Data []map[string]any `json:"data"`
		}
		if err := call(http.MethodGet, "/v1/support/plans", nil, &r); err != nil {
			return err
		}
		if jsonOut {
			emit(r.Data)
			return nil
		}
		for _, p := range r.Data {
			fmt.Fprintf(stdout, "%-10s %8.2f %s/mo  %s\n", p["id"], toFloat(p["monthlyMinor"])/100, p["currency"], p["summary"])
		}
		return nil
	case "plan":
		if len(args) > 1 {
			if err := call(http.MethodPut, "/v1/support/plan", map[string]any{"plan": args[1]}, &out); err != nil {
				return err
			}
		} else if err := call(http.MethodGet, "/v1/support/plan", nil, &out); err != nil {
			return err
		}
		if jsonOut {
			emit(out)
			return nil
		}
		d, _ := out["details"].(map[string]any)
		fmt.Fprintf(stdout, "plan: %v  open tickets: %v", out["plan"], out["openTickets"])
		if d != nil {
			fmt.Fprintf(stdout, "  %.2f %s/mo", toFloat(d["monthlyMinor"])/100, d["currency"])
		}
		fmt.Fprintln(stdout)
		return nil
	case "tickets", "ls":
		status, _ := flag(args[1:], "--status")
		path := "/v1/support/tickets"
		if status != "" {
			path += "?status=" + status
		}
		return cmdList(path, nil, []string{"number", "status", "priority", "subject", "updatedAt", "id"})
	case "new":
		if len(args) < 2 {
			return usage
		}
		body, rest := flag(args[2:], "--body")
		prio, rest := flag(rest, "--priority")
		about, _ := flag(rest, "--about")
		if body == "" {
			return errors.New("--body is required")
		}
		req := map[string]any{"subject": args[1], "body": body}
		if prio != "" {
			req["priority"] = prio
		}
		if about != "" {
			req["resource"] = about
		}
		if err := call(http.MethodPost, "/v1/support/tickets", req, &out); err != nil {
			return err
		}
		if jsonOut {
			emit(out)
			return nil
		}
		fmt.Fprintf(stdout, "✓ ticket #%v opened (%v); first response by %v\n", out["number"], out["id"], orEmpty(out["firstResponseDueAt"]))
		return nil
	case "show", "get":
		if len(args) < 2 {
			return usage
		}
		if err := call(http.MethodGet, "/v1/support/tickets/"+args[1], nil, &out); err != nil {
			return err
		}
		if jsonOut {
			emit(out)
			return nil
		}
		fmt.Fprintf(stdout, "#%v %v  [%v, %v]\n", out["number"], out["subject"], out["status"], out["priority"])
		for _, m := range toList(out["messages"]) {
			mm, _ := m.(map[string]any)
			who := "customer"
			if b, _ := mm["fromSupport"].(bool); b {
				who = "support"
			}
			fmt.Fprintf(stdout, "\n--- %v (%s) %v\n%v\n", mm["author"], who, mm["createdAt"], mm["body"])
		}
		return nil
	case "reply":
		if len(args) < 3 {
			return usage
		}
		if err := call(http.MethodPost, "/v1/support/tickets/"+args[1]+"/messages", map[string]any{"body": strings.Join(args[2:], " ")}, &out); err != nil {
			return err
		}
		fmt.Fprintf(stdout, "✓ reply added to #%v\n", out["number"])
		return nil
	case "close":
		if len(args) < 2 {
			return usage
		}
		if err := call(http.MethodPost, "/v1/support/tickets/"+args[1]+"/close", nil, &out); err != nil {
			return err
		}
		fmt.Fprintf(stdout, "✓ ticket #%v closed\n", out["number"])
		return nil
	}
	return usage
}

func toFloat(v any) float64 {
	f, _ := v.(float64)
	return f
}

// cmdKubernetes: managed Kubernetes clusters and their node pools.
func cmdKubernetes(args []string) error {
	if len(args) == 0 || args[0] == "ls" {
		return cmdList("/v1/kubernetes/clusters", nil, []string{"name", "version", "status", "workers", "readyNodes", "endpoint", "id"})
	}
	usage := errors.New("usage: pgcloud kubernetes [ls | create NAME [--size S] [--count N] [--version V] [--ha] [--wait] | get ID | kubeconfig ID | pools ID [add NAME --size S --count N | scale POOL_ID N | rm POOL_ID] | delete ID]")
	var c map[string]any
	switch args[0] {
	case "create":
		if len(args) < 2 {
			return usage
		}
		size, rest := flag(args[2:], "--size")
		count, rest := flag(rest, "--count")
		version, rest := flag(rest, "--version")
		ha := hasFlag(rest, "--ha")
		wait := hasFlag(rest, "--wait")
		n := 2
		if count != "" {
			fmt.Sscanf(count, "%d", &n)
		}
		body := map[string]any{"name": args[1], "ha": ha, "pools": []map[string]any{{"name": "default", "size": or(size, "s-2vcpu-4gb"), "count": n}}}
		if version != "" {
			body["version"] = version
		}
		if err := call(http.MethodPost, "/v1/kubernetes/clusters", body, &c); err != nil {
			return err
		}
		fmt.Fprintf(stdout, "✓ cluster %s is being created (%s)\n", c["name"], c["id"])
		if wait {
			return waitKubernetes(c["id"].(string))
		}
		return nil
	case "get":
		if len(args) < 2 {
			return usage
		}
		if err := call(http.MethodGet, "/v1/kubernetes/clusters/"+args[1], nil, &c); err != nil {
			return err
		}
		if jsonOut {
			return printJSON(c)
		}
		fmt.Fprintf(stdout, "%s  kubernetes %v  %v %v\n  endpoint %v  workers %v  ready %v  config v%v\n", c["name"], c["version"], c["status"], orEmpty(c["statusMessage"]), orEmpty(c["endpoint"]), c["workers"], c["readyNodes"], c["configVersion"])
		for _, n := range toList(c["controlPlane"]) {
			nn, _ := n.(map[string]any)
			fmt.Fprintf(stdout, "  control  %-28v %-10v ready=%v %v\n", nn["name"], nn["status"], nn["ready"], orEmpty(nn["ip"]))
		}
		for _, p := range toList(c["pools"]) {
			pp, _ := p.(map[string]any)
			sz, _ := pp["size"].(map[string]any)
			fmt.Fprintf(stdout, "  pool %v (%v) size %v count %v\n", pp["name"], pp["id"], sz["id"], pp["count"])
			for _, n := range toList(pp["nodes"]) {
				nn, _ := n.(map[string]any)
				fmt.Fprintf(stdout, "    worker %-28v %-10v ready=%v %v\n", nn["name"], nn["status"], nn["ready"], orEmpty(nn["ip"]))
			}
		}
		if cloud, ok := c["cloud"].(map[string]any); ok {
			for _, l := range toList(cloud["loadBalancers"]) {
				ll, _ := l.(map[string]any)
				fmt.Fprintf(stdout, "  service %v -> load balancer %v %v\n", ll["service"], ll["loadBalancerId"], orEmpty(ll["ip"]))
			}
			for _, v := range toList(cloud["volumes"]) {
				vv, _ := v.(map[string]any)
				fmt.Fprintf(stdout, "  claim %v -> volume %v %vGB on %v\n", vv["claim"], vv["volumeId"], vv["sizeGb"], vv["node"])
			}
		}
		return nil
	case "kubeconfig":
		if len(args) < 2 {
			return usage
		}
		var text string
		if err := callText(http.MethodGet, "/v1/kubernetes/clusters/"+args[1]+"/kubeconfig", &text); err != nil {
			return err
		}
		fmt.Fprint(stdout, text)
		return nil
	case "pools":
		if len(args) < 3 {
			return usage
		}
		id := args[1]
		switch args[2] {
		case "add":
			if len(args) < 4 {
				return usage
			}
			size, rest := flag(args[4:], "--size")
			count, _ := flag(rest, "--count")
			n := 1
			if count != "" {
				fmt.Sscanf(count, "%d", &n)
			}
			if err := call(http.MethodPost, "/v1/kubernetes/clusters/"+id+"/pools", map[string]any{"name": args[3], "size": or(size, "s-2vcpu-4gb"), "count": n}, &c); err != nil {
				return err
			}
			fmt.Fprintf(stdout, "✓ pool %s added\n", args[3])
		case "scale":
			if len(args) < 5 {
				return usage
			}
			var n int
			fmt.Sscanf(args[4], "%d", &n)
			if err := call(http.MethodPatch, "/v1/kubernetes/clusters/"+id+"/pools/"+args[3], map[string]any{"count": n}, &c); err != nil {
				return err
			}
			fmt.Fprintf(stdout, "✓ pool scaled to %d\n", n)
		case "rm", "delete":
			if len(args) < 4 {
				return usage
			}
			if err := call(http.MethodDelete, "/v1/kubernetes/clusters/"+id+"/pools/"+args[3], nil, &c); err != nil {
				return err
			}
			fmt.Fprintln(stdout, "✓ pool removed")
		default:
			return usage
		}
		return nil
	case "delete", "rm":
		if len(args) < 2 {
			return usage
		}
		if err := call(http.MethodDelete, "/v1/kubernetes/clusters/"+args[1], nil, &c); err != nil {
			return err
		}
		fmt.Fprintf(stdout, "✓ cluster %s is being deleted\n", args[1])
		return nil
	}
	return usage
}

func waitKubernetes(id string) error {
	for i := 0; i < 240; i++ {
		var c map[string]any
		if err := call(http.MethodGet, "/v1/kubernetes/clusters/"+id, nil, &c); err != nil {
			return err
		}
		switch c["status"] {
		case "active":
			fmt.Fprintf(stdout, "✓ cluster %v is active at %v\n", c["name"], c["endpoint"])
			return nil
		case "failed":
			return fmt.Errorf("cluster failed: %v", orEmpty(c["statusMessage"]))
		}
		time.Sleep(10 * time.Second)
	}
	return errors.New("timed out waiting for the cluster")
}

// cmdApp: the App Platform (containers on shared hosts).
func cmdApp(args []string) error {
	if len(args) == 0 || args[0] == "ls" {
		return cmdList("/v1/app-platform/apps", nil, []string{"name", "status", "url", "branch", "instances", "id"})
	}
	usage := errors.New("usage: pgcloud app [ls | create NAME REPO_URL [--branch B] [--port P] [--size app-xs] [--instances N] [--env K=V] [--git-token T] [--wait] | get ID | deploy ID | logs ID [--runtime] [--follow] | scale ID N | env ID K=V... | domains ID [add D | rm D] | stop ID | start ID | delete ID]")
	var a map[string]any
	switch args[0] {
	case "create":
		if len(args) < 3 {
			return usage
		}
		branch, rest := flag(args[3:], "--branch")
		port, rest := flag(rest, "--port")
		size, rest := flag(rest, "--size")
		inst, rest := flag(rest, "--instances")
		token, rest := flag(rest, "--git-token")
		envs, rest := multi(rest, "--env")
		wait := hasFlag(rest, "--wait")
		body := map[string]any{"name": args[1], "repoUrl": args[2]}
		if branch != "" {
			body["branch"] = branch
		}
		if port != "" {
			var p int
			fmt.Sscanf(port, "%d", &p)
			body["port"] = p
		}
		if size != "" {
			body["size"] = size
		}
		if inst != "" {
			var n int
			fmt.Sscanf(inst, "%d", &n)
			body["instances"] = n
		}
		if token != "" {
			body["gitToken"] = token
		}
		if len(envs) > 0 {
			env := map[string]string{}
			for _, kv := range envs {
				if i := strings.Index(kv, "="); i > 0 {
					env[kv[:i]] = kv[i+1:]
				}
			}
			body["env"] = env
		}
		if err := call(http.MethodPost, "/v1/app-platform/apps", body, &a); err != nil {
			return err
		}
		fmt.Fprintf(stdout, "✓ app %v is being built (%v); it will answer at %v\n", a["name"], a["id"], a["url"])
		if wait {
			return waitApp(a["id"].(string))
		}
		return nil
	case "get":
		if len(args) < 2 {
			return usage
		}
		if err := call(http.MethodGet, "/v1/app-platform/apps/"+args[1], nil, &a); err != nil {
			return err
		}
		if jsonOut {
			return printJSON(a)
		}
		sz, _ := a["size"].(map[string]any)
		fmt.Fprintf(stdout, "%v  %v %v\n  url %v\n  source %v@%v  commit %v\n  size %v x %v  port %v\n", a["name"], a["status"], orEmpty(a["statusMessage"]), a["url"], orEmpty(a["repo"]), a["branch"], orEmpty(a["lastCommit"]), sz["id"], a["instances"], a["port"])
		for _, d := range toList(a["customDomains"]) {
			fmt.Fprintf(stdout, "  domain %v\n", d)
		}
		for _, d := range toList(a["deploys"]) {
			dd, _ := d.(map[string]any)
			fmt.Fprintf(stdout, "  deploy %-8v %-7v %v %v\n", dd["status"], dd["trigger"], orEmpty(dd["commit"]), dd["startedAt"])
		}
		return nil
	case "deploy":
		if len(args) < 2 {
			return usage
		}
		if err := call(http.MethodPost, "/v1/app-platform/apps/"+args[1]+"/deploy", map[string]any{}, &a); err != nil {
			return err
		}
		fmt.Fprintln(stdout, "✓ deploy started")
		return nil
	case "logs":
		if len(args) < 2 {
			return usage
		}
		kind := "build"
		if hasFlag(args[2:], "--runtime") {
			kind = "runtime"
		}
		follow := hasFlag(args[2:], "--follow")
		last := ""
		for {
			var l struct {
				Log string `json:"log"`
			}
			if err := call(http.MethodGet, "/v1/app-platform/apps/"+args[1]+"/logs?type="+kind, nil, &l); err != nil {
				return err
			}
			if jsonOut {
				emit(l)
				return nil
			}
			if l.Log != last {
				fmt.Fprint(stdout, strings.TrimPrefix(l.Log, last))
				last = l.Log
			}
			if !follow {
				return nil
			}
			time.Sleep(4 * time.Second)
		}
	case "scale":
		if len(args) < 3 {
			return usage
		}
		var n int
		fmt.Sscanf(args[2], "%d", &n)
		if err := call(http.MethodPatch, "/v1/app-platform/apps/"+args[1], map[string]any{"instances": n}, &a); err != nil {
			return err
		}
		fmt.Fprintf(stdout, "✓ scaling to %d instances\n", n)
		return nil
	case "env":
		if len(args) < 3 {
			return usage
		}
		if err := call(http.MethodGet, "/v1/app-platform/apps/"+args[1], nil, &a); err != nil {
			return err
		}
		env := map[string]any{}
		if cur, ok := a["env"].(map[string]any); ok {
			for k, v := range cur {
				env[k] = v
			}
		}
		for _, kv := range args[2:] {
			if i := strings.Index(kv, "="); i > 0 {
				if kv[i+1:] == "" {
					delete(env, kv[:i])
				} else {
					env[kv[:i]] = kv[i+1:]
				}
			}
		}
		if err := call(http.MethodPatch, "/v1/app-platform/apps/"+args[1], map[string]any{"env": env}, &a); err != nil {
			return err
		}
		fmt.Fprintf(stdout, "✓ %d variables set; deploying\n", len(env))
		return nil
	case "domains":
		if len(args) < 4 {
			return usage
		}
		switch args[2] {
		case "add":
			if err := call(http.MethodPost, "/v1/app-platform/apps/"+args[1]+"/domains", map[string]any{"domain": args[3]}, &a); err != nil {
				return err
			}
			fmt.Fprintf(stdout, "✓ %s added; point a CNAME at %v\n", args[3], a["hostname"])
		case "rm", "remove":
			if err := call(http.MethodDelete, "/v1/app-platform/apps/"+args[1]+"/domains/"+args[3], nil, &a); err != nil {
				return err
			}
			fmt.Fprintf(stdout, "✓ %s removed\n", args[3])
		default:
			return usage
		}
		return nil
	case "stop", "start":
		if len(args) < 2 {
			return usage
		}
		if err := call(http.MethodPost, "/v1/app-platform/apps/"+args[1]+"/"+args[0], map[string]any{}, &a); err != nil {
			return err
		}
		fmt.Fprintf(stdout, "✓ app %v is %v\n", a["name"], a["status"])
		return nil
	case "delete", "rm":
		if len(args) < 2 {
			return usage
		}
		if err := call(http.MethodDelete, "/v1/app-platform/apps/"+args[1], nil, &a); err != nil {
			return err
		}
		fmt.Fprintln(stdout, "✓ app is being deleted")
		return nil
	}
	return usage
}

func waitApp(id string) error {
	for i := 0; i < 180; i++ {
		var a map[string]any
		if err := call(http.MethodGet, "/v1/app-platform/apps/"+id, nil, &a); err != nil {
			return err
		}
		switch a["status"] {
		case "live":
			fmt.Fprintf(stdout, "✓ %v is live at %v\n", a["name"], a["url"])
			return nil
		case "failed":
			return fmt.Errorf("app failed: %v (see: pgcloud app logs %s)", orEmpty(a["statusMessage"]), id)
		}
		time.Sleep(10 * time.Second)
	}
	return errors.New("timed out waiting for the app")
}
