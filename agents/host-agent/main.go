// prgd host agent — runs on every Proxmox VE node.
//
// It is the only custom code in the data plane: it subscribes to its job subject on
// NATS, executes jobs against the local Proxmox API, and publishes a heartbeat and
// per-minute usage events. If the control plane disappears, customer VMs keep running
// and the agent simply keeps buffering heartbeats.
package main

import (
	"context"
	"flag"
	"log/slog"
	"os"
	"os/signal"
	"syscall"

	"github.com/prgd/host-agent/internal/agent"
	"github.com/prgd/host-agent/internal/config"
	"github.com/prgd/host-agent/internal/proxmox"
)

var version = "dev"

func main() {
	cfgPath := flag.String("config", "/etc/prgd/agent.yaml", "path to agent config")
	flag.Parse()

	log := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo}))

	cfg, err := config.Load(*cfgPath)
	if err != nil {
		log.Error("config", "err", err)
		os.Exit(1)
	}

	pve := proxmox.New(cfg.Proxmox, log)

	ctx, cancel := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer cancel()

	a, err := agent.New(cfg, pve, version, log)
	if err != nil {
		log.Error("start", "err", err)
		os.Exit(1)
	}
	if err := a.Run(ctx); err != nil && ctx.Err() == nil {
		log.Error("run", "err", err)
		os.Exit(1)
	}
	log.Info("agent stopped")
}
