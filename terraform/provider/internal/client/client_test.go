package client

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestDoSendsAuthAndIdempotencyAndMapsErrors(t *testing.T) {
	var got *http.Request
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		got = r.Clone(context.Background())
		if r.URL.Path == "/v1/servers/missing" {
			w.WriteHeader(404)
			_, _ = w.Write([]byte(`{"error":{"code":"not_found","message":"server missing not found"}}`))
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]string{"id": "srv_1"})
	}))
	defer srv.Close()
	c := New(srv.URL+"/v1", "prgd_x")
	if c.BaseURL != srv.URL {
		t.Fatalf("base url not normalized: %s", c.BaseURL)
	}
	var out struct{ ID string }
	if err := c.Do(context.Background(), http.MethodPost, "/v1/servers", map[string]string{"name": "a"}, &out); err != nil || out.ID != "srv_1" {
		t.Fatalf("post: %v %+v", err, out)
	}
	if got.Header.Get("Authorization") != "Bearer prgd_x" || got.Header.Get("Idempotency-Key") == "" {
		t.Fatalf("headers: %v", got.Header)
	}
	if err := c.Do(context.Background(), http.MethodGet, "/v1/sizes", nil, &out); err != nil {
		t.Fatal(err)
	}
	if got.Header.Get("Idempotency-Key") != "" {
		t.Fatal("GET must not send an idempotency key")
	}
	err := c.Do(context.Background(), http.MethodGet, "/v1/servers/missing", nil, &out)
	if !IsNotFound(err) || err.(*APIError).Code != "not_found" {
		t.Fatalf("expected not_found, got %v", err)
	}
}

func TestWaitServer(t *testing.T) {
	n := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		n++
		status := "provisioning"
		if n >= 2 {
			status = "active"
		}
		_ = json.NewEncoder(w).Encode(map[string]interface{}{"id": "s", "status": status, "networks": map[string]interface{}{"v4": []map[string]string{{"ipAddress": "203.0.113.4"}}}})
	}))
	defer srv.Close()
	c := New(srv.URL, "t")
	s, err := c.WaitServer(context.Background(), "s", 30*time.Second)
	if err != nil || s.Status != "active" || s.Networks.V4[0].IPAddress != "203.0.113.4" {
		t.Fatalf("wait: %v %+v", err, s)
	}
	failed := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]interface{}{"id": "s", "status": "failed", "statusMessage": "No capacity"})
	}))
	defer failed.Close()
	if _, err := New(failed.URL, "t").WaitServer(context.Background(), "s", time.Second); err == nil || err.Error() != "server s: No capacity" {
		t.Fatalf("expected failure message, got %v", err)
	}
}
