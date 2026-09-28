// Package client is the thin HTTP client the provider uses. It mirrors the CLI: bearer
// token, JSON, an Idempotency-Key on every write, and API errors surfaced with their code.
package client

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"
)

type Client struct {
	BaseURL string
	Token   string
	HTTP    *http.Client
}

type APIError struct {
	Status  int
	Code    string
	Message string
}

func (e *APIError) Error() string {
	return fmt.Sprintf("prgd %s (%d): %s", e.Code, e.Status, e.Message)
}

// DoText performs a request whose answer is plain text or YAML, such as the kubeconfig.
func (c *Client) DoText(ctx context.Context, method, path string) (string, error) {
	req, err := http.NewRequestWithContext(ctx, method, c.BaseURL+path, nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("Authorization", "Bearer "+c.Token)
	req.Header.Set("Accept", "*/*")
	req.Header.Set("User-Agent", "terraform-provider-prgd/0.1.0")
	res, err := c.HTTP.Do(req)
	if err != nil {
		return "", err
	}
	defer res.Body.Close()
	raw, _ := io.ReadAll(res.Body)
	if res.StatusCode >= 400 {
		var env struct {
			Error struct {
				Code    string `json:"code"`
				Message string `json:"message"`
			} `json:"error"`
		}
		_ = json.Unmarshal(raw, &env)
		return "", &APIError{Status: res.StatusCode, Code: env.Error.Code, Message: env.Error.Message}
	}
	return string(raw), nil
}

func IsNotFound(err error) bool {
	e, ok := err.(*APIError)
	return ok && e.Status == 404
}

func New(baseURL, token string) *Client {
	return &Client{BaseURL: strings.TrimSuffix(strings.TrimRight(baseURL, "/"), "/v1"), Token: token, HTTP: &http.Client{Timeout: 60 * time.Second}}
}

func (c *Client) Do(ctx context.Context, method, path string, body, out interface{}) error {
	var rdr io.Reader
	if body != nil {
		b, _ := json.Marshal(body)
		rdr = bytes.NewReader(b)
	}
	req, err := http.NewRequestWithContext(ctx, method, c.BaseURL+path, rdr)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+c.Token)
	req.Header.Set("Accept", "application/json")
	req.Header.Set("User-Agent", "terraform-provider-prgd/0.1.0")
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Idempotency-Key", uuid.NewString())
	}
	res, err := c.HTTP.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	raw, _ := io.ReadAll(res.Body)
	if res.StatusCode >= 400 {
		var env struct {
			Error struct {
				Code    string `json:"code"`
				Message string `json:"message"`
			} `json:"error"`
		}
		_ = json.Unmarshal(raw, &env)
		if env.Error.Code == "" {
			env.Error.Code, env.Error.Message = "http_error", strings.TrimSpace(string(raw))
		}
		return &APIError{Status: res.StatusCode, Code: env.Error.Code, Message: env.Error.Message}
	}
	if out != nil && len(raw) > 0 {
		return json.Unmarshal(raw, out)
	}
	return nil
}

// ---- shapes the provider reads ----

type Server struct {
	ID            string  `json:"id"`
	Name          string  `json:"name"`
	Status        string  `json:"status"`
	StatusMessage *string `json:"statusMessage"`
	Region        struct {
		ID string `json:"id"`
	} `json:"region"`
	Size struct {
		ID string `json:"id"`
	} `json:"size"`
	Image struct {
		ID string `json:"id"`
	} `json:"image"`
	Networks struct {
		V4 []struct {
			IPAddress string `json:"ipAddress"`
		} `json:"v4"`
		Private []struct {
			IPAddress string `json:"ipAddress"`
		} `json:"private"`
	} `json:"networks"`
	Firewalls      []string `json:"firewalls"`
	BackupsEnabled bool     `json:"backupsEnabled"`
	Managed        bool     `json:"managed"`
	Tags           []string `json:"tags"`
	ProjectID      string   `json:"projectId"`
}

// WaitServer polls until the server settles. Failed provisioning is an error.
func (c *Client) WaitServer(ctx context.Context, id string, timeout time.Duration) (*Server, error) {
	deadline := time.Now().Add(timeout)
	for {
		var s Server
		if err := c.Do(ctx, http.MethodGet, "/v1/servers/"+id, nil, &s); err != nil {
			return nil, err
		}
		switch s.Status {
		case "active", "off":
			return &s, nil
		case "failed":
			msg := "provisioning failed"
			if s.StatusMessage != nil {
				msg = *s.StatusMessage
			}
			return &s, fmt.Errorf("server %s: %s", id, msg)
		}
		if time.Now().After(deadline) {
			return &s, fmt.Errorf("server %s still %s after %s", id, s.Status, timeout)
		}
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-time.After(3 * time.Second):
		}
	}
}

// WaitGone polls until the server no longer exists.
func (c *Client) WaitGone(ctx context.Context, id string, timeout time.Duration) error {
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		var s Server
		err := c.Do(ctx, http.MethodGet, "/v1/servers/"+id, nil, &s)
		if IsNotFound(err) {
			return nil
		}
		if err != nil {
			return err
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(3 * time.Second):
		}
	}
	return fmt.Errorf("server %s still exists after %s", id, timeout)
}

type Volume struct {
	ID            string  `json:"id"`
	Name          string  `json:"name"`
	SizeGb        int     `json:"sizeGb"`
	Status        string  `json:"status"`
	StatusMessage *string `json:"statusMessage"`
	ServerID      *string `json:"serverId"`
	Device        *string `json:"device"`
	RegionID      string  `json:"regionId"`
}

// WaitVolume polls until the volume is available or attached. A failed transition is an error
// that carries the API's status message.
func (c *Client) WaitVolume(ctx context.Context, id string, timeout time.Duration) (*Volume, error) {
	deadline := time.Now().Add(timeout)
	for {
		var v Volume
		if err := c.Do(ctx, http.MethodGet, "/v1/volumes/"+id, nil, &v); err != nil {
			return nil, err
		}
		switch v.Status {
		case "available", "attached":
			if v.StatusMessage != nil && *v.StatusMessage != "" {
				return &v, fmt.Errorf("volume %s: %s", id, *v.StatusMessage)
			}
			return &v, nil
		case "failed":
			msg := "provisioning failed"
			if v.StatusMessage != nil {
				msg = *v.StatusMessage
			}
			return &v, fmt.Errorf("volume %s: %s", id, msg)
		}
		if time.Now().After(deadline) {
			return &v, fmt.Errorf("volume %s still %s after %s", id, v.Status, timeout)
		}
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-time.After(2 * time.Second):
		}
	}
}

type LoadBalancer struct {
	ID                  string  `json:"id"`
	Name                string  `json:"name"`
	Status              string  `json:"status"`
	StatusMessage       *string `json:"statusMessage"`
	IP                  *string `json:"ip"`
	RegionID            string  `json:"regionId"`
	Algorithm           string  `json:"algorithm"`
	Nodes               int     `json:"nodes"`
	RedirectHTTPToHTTPS bool    `json:"redirectHttpToHttps"`
	Tag                 *string `json:"tag"`
	StickySessions      *struct {
		Type string `json:"type"`
	} `json:"stickySessions"`
	HealthCheck struct {
		Path string `json:"path"`
	} `json:"healthCheck"`
	ForwardingRules []struct {
		EntryProtocol  string `json:"entryProtocol"`
		EntryPort      int    `json:"entryPort"`
		TargetProtocol string `json:"targetProtocol"`
		TargetPort     int    `json:"targetPort"`
		CertificateID  string `json:"certificateId"`
	} `json:"forwardingRules"`
	Targets []struct {
		ServerID string `json:"serverId"`
	} `json:"targets"`
}

// WaitLoadBalancer polls until the load balancer is active. Failed provisioning is an error.
func (c *Client) WaitLoadBalancer(ctx context.Context, id string, timeout time.Duration) (*LoadBalancer, error) {
	deadline := time.Now().Add(timeout)
	for {
		var lb LoadBalancer
		if err := c.Do(ctx, http.MethodGet, "/v1/load-balancers/"+id, nil, &lb); err != nil {
			return nil, err
		}
		switch lb.Status {
		case "active":
			return &lb, nil
		case "failed":
			msg := "provisioning failed"
			if lb.StatusMessage != nil {
				msg = *lb.StatusMessage
			}
			return &lb, fmt.Errorf("load balancer %s: %s", id, msg)
		}
		if time.Now().After(deadline) {
			return &lb, fmt.Errorf("load balancer %s still %s after %s", id, lb.Status, timeout)
		}
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-time.After(3 * time.Second):
		}
	}
}

type DnsRecord struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	Type     string `json:"type"`
	Content  string `json:"content"`
	TTL      int    `json:"ttl"`
	Priority *int   `json:"priority"`
}

type Domain struct {
	ID          string      `json:"id"`
	Name        string      `json:"name"`
	Status      string      `json:"status"`
	Nameservers []string    `json:"nameservers"`
	Records     []DnsRecord `json:"records"`
}

type Bucket struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	Status   string `json:"status"`
	RegionID string `json:"regionId"`
	Public   bool   `json:"public"`
	Endpoint string `json:"endpoint"`
	URL      string `json:"url"`
}

type Database struct {
	ID             string   `json:"id"`
	Name           string   `json:"name"`
	Engine         string   `json:"engine"`
	Version        string   `json:"version"`
	Status         string   `json:"status"`
	StatusMessage  *string  `json:"statusMessage"`
	Nodes          int      `json:"nodes"`
	RegionID       string   `json:"regionId"`
	TrustedSources []string `json:"trustedSources"`
	BackupHourUTC  int      `json:"backupHourUtc"`
	Size           struct {
		ID string `json:"id"`
	} `json:"size"`
	Connection struct {
		Host        *string `json:"host"`
		PrivateHost *string `json:"privateHost"`
		Port        int     `json:"port"`
		Database    string  `json:"database"`
		User        string  `json:"user"`
		Password    string  `json:"password"`
		URI         *string `json:"uri"`
	} `json:"connection"`
}

// WaitDatabase polls until the cluster is active. Failed provisioning is an error.
func (c *Client) WaitDatabase(ctx context.Context, id string, timeout time.Duration) (*Database, error) {
	deadline := time.Now().Add(timeout)
	for {
		var d Database
		if err := c.Do(ctx, http.MethodGet, "/v1/databases/"+id, nil, &d); err != nil {
			return nil, err
		}
		switch d.Status {
		case "active":
			return &d, nil
		case "failed":
			msg := "provisioning failed"
			if d.StatusMessage != nil {
				msg = *d.StatusMessage
			}
			return &d, fmt.Errorf("database %s: %s", id, msg)
		}
		if time.Now().After(deadline) {
			return &d, fmt.Errorf("database %s still %s after %s", id, d.Status, timeout)
		}
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-time.After(5 * time.Second):
		}
	}
}

type FirewallRule struct {
	Direction string   `json:"direction"`
	Protocol  string   `json:"protocol"`
	Ports     *string  `json:"ports,omitempty"`
	Cidrs     []string `json:"cidrs"`
}

type Firewall struct {
	ID    string         `json:"id"`
	Name  string         `json:"name"`
	Rules []FirewallRule `json:"rules"`
}

type SshKey struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Fingerprint string `json:"fingerprint"`
	PublicKey   string `json:"publicKey"`
}

type Size struct {
	ID         string  `json:"id"`
	Vcpu       int64   `json:"vcpu"`
	MemoryMb   int64   `json:"memoryMb"`
	DiskGb     int64   `json:"diskGb"`
	TransferTb float64 `json:"transferTb"`
}

type Image struct {
	ID   string `json:"id"`
	Kind string `json:"kind"`
	Name string `json:"name"`
}

// KubeCluster is a managed Kubernetes cluster as the API presents it.
type KubeCluster struct {
	ID            string  `json:"id"`
	Name          string  `json:"name"`
	Version       string  `json:"version"`
	Status        string  `json:"status"`
	StatusMessage *string `json:"statusMessage"`
	HA            bool    `json:"ha"`
	Endpoint      *string `json:"endpoint"`
	Workers       int     `json:"workers"`
	ReadyNodes    int     `json:"readyNodes"`
	Region        struct {
		ID string `json:"id"`
	} `json:"region"`
	Pools []struct {
		ID    string `json:"id"`
		Name  string `json:"name"`
		Count int    `json:"count"`
		Size  struct {
			ID string `json:"id"`
		} `json:"size"`
	} `json:"pools"`
}

// WaitKubernetes polls until the cluster is active or failed.
func (c *Client) WaitKubernetes(ctx context.Context, id string, timeout time.Duration) (*KubeCluster, error) {
	deadline := time.Now().Add(timeout)
	for {
		var k KubeCluster
		if err := c.Do(ctx, http.MethodGet, "/v1/kubernetes/clusters/"+id, nil, &k); err != nil {
			return nil, err
		}
		switch k.Status {
		case "active":
			return &k, nil
		case "failed":
			msg := "provisioning failed"
			if k.StatusMessage != nil {
				msg = *k.StatusMessage
			}
			return &k, fmt.Errorf("kubernetes cluster %s: %s", id, msg)
		}
		if time.Now().After(deadline) {
			return &k, fmt.Errorf("kubernetes cluster %s is still %s", id, k.Status)
		}
		select {
		case <-ctx.Done():
			return &k, ctx.Err()
		case <-time.After(10 * time.Second):
		}
	}
}

// PlatformApp is an App Platform app as the API presents it.
type PlatformApp struct {
	ID            string            `json:"id"`
	Name          string            `json:"name"`
	Status        string            `json:"status"`
	StatusMessage *string           `json:"statusMessage"`
	URL           string            `json:"url"`
	RepoURL       string            `json:"repoUrl"`
	Branch        string            `json:"branch"`
	Port          int               `json:"port"`
	Instances     int               `json:"instances"`
	Env           map[string]string `json:"env"`
	Size          struct {
		ID string `json:"id"`
	} `json:"size"`
}

// WaitApp polls until the app is live or failed.
func (c *Client) WaitApp(ctx context.Context, id string, timeout time.Duration) (*PlatformApp, error) {
	deadline := time.Now().Add(timeout)
	for {
		var a PlatformApp
		if err := c.Do(ctx, http.MethodGet, "/v1/app-platform/apps/"+id, nil, &a); err != nil {
			return nil, err
		}
		switch a.Status {
		case "live", "stopped":
			return &a, nil
		case "failed":
			msg := "build failed"
			if a.StatusMessage != nil {
				msg = *a.StatusMessage
			}
			return &a, fmt.Errorf("app %s: %s", id, msg)
		}
		if time.Now().After(deadline) {
			return &a, fmt.Errorf("app %s is still %s", id, a.Status)
		}
		select {
		case <-ctx.Done():
			return &a, ctx.Err()
		case <-time.After(5 * time.Second):
		}
	}
}
