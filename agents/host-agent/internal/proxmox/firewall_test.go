package proxmox

import (
	"context"
	"testing"

	"github.com/prgd/host-agent/internal/config"
	"github.com/prgd/host-agent/internal/pvesim"
)

// Drop rules only work above the accept rules, so the stored order must be the order given,
// whether Proxmox inserts new rules at the top (it does) or appends them.
func TestSetFirewallKeepsRuleOrder(t *testing.T) {
	rules := []FWRule{
		{Type: "in", Action: "DROP", Proto: "any", Source: "10.96.0.0/14", Iface: "net0"},
		{Type: "out", Action: "DROP", Proto: "tcp", Dport: "25", Dest: "0.0.0.0/0"},
		{Type: "in", Action: "ACCEPT", Proto: "tcp", Dport: "22", Source: "0.0.0.0/0"},
		{Type: "out", Action: "ACCEPT", Proto: "any", Dest: "0.0.0.0/0"},
	}
	for _, appendMode := range []bool{false, true} {
		sim := pvesim.New("pve1")
		sim.FWAppend = appendMode
		c := New(config.Proxmox{URL: sim.URL(), Node: "pve1", TokenID: sim.TokenID, TokenSecret: sim.TokenSecret}, quietLog())
		for round := 0; round < 2; round++ { // the second round uses the learned order directly
			if err := c.SetFirewall(context.Background(), 9000, rules, false); err != nil {
				t.Fatalf("append=%v round %d: %v", appendMode, round, err)
			}
			got := sim.VM(9000).FWRules
			if len(got) != len(rules) {
				t.Fatalf("append=%v: %d rules stored, want %d: %v", appendMode, len(got), len(rules), got)
			}
			for i, r := range rules {
				if got[i]["action"] != r.Action || got[i]["type"] != r.Type || got[i]["iface"] != r.Iface || got[i]["source"] != r.Source || got[i]["dest"] != r.Dest {
					t.Fatalf("append=%v round %d: rule %d is %v, want %+v", appendMode, round, i, got[i], r)
				}
			}
		}
		if got := sim.VM(9000).FWRules[0]; got["iface"] != "net0" || got["proto"] != "" {
			t.Fatalf("iface not sent or proto any not dropped: %v", got)
		}
		sim.Close()
	}
}
