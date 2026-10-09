package main

import "testing"

func TestNewOutput(t *testing.T) {
	cases := []struct{ prev, out, want string }{
		{"", "a\n", "a\n"},
		{"a\n", "a\nb\n", "b\n"},
		{"a\nb\nc\n", "b\nc\nd\n", "d\n"},
		{"x\n", "y\n", "y\n"},
	}
	for _, c := range cases {
		if got := newOutput(c.prev, c.out); got != c.want {
			t.Errorf("newOutput(%q, %q) = %q, want %q", c.prev, c.out, got, c.want)
		}
	}
}

func TestRunExitCode(t *testing.T) {
	cases := []struct {
		status string
		exit   any
		want   int
	}{
		{"succeeded", 0.0, 0}, {"failed", 3.0, 3}, {"failed", nil, 1}, {"timed_out", 137.0, 124}, {"canceled", 137.0, 130},
	}
	for _, c := range cases {
		if got := runExitCode(c.status, c.exit); got != c.want {
			t.Errorf("runExitCode(%q, %v) = %d, want %d", c.status, c.exit, got, c.want)
		}
	}
}

func TestParseGlobalStopsAtDoubleDash(t *testing.T) {
	jsonOut = false
	got := parseGlobal([]string{"--json", "app", "run", "web", "--", "node", "--json"})
	want := []string{"app", "run", "web", "--", "node", "--json"}
	if !jsonOut || len(got) != len(want) {
		t.Fatalf("parseGlobal = %v (json %v)", got, jsonOut)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("parseGlobal = %v", got)
		}
	}
	jsonOut = false
}
