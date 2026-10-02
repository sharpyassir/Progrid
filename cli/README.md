# prgd CLI

One static Go binary, zero dependencies, same API as the console.

```sh
curl -fsSL https://get.progrid.co | sh        # macOS / Linux, amd64 / arm64
prgd login                                        # email + password, or paste a prgd_ token
```

```sh
prgd servers create web-1 --size s-2vcpu-4gb --image ubuntu-24-04 --wait
prgd ssh web-1
prgd deploy https://github.com/you/app --branch main --port 3000 --wait
prgd deploys ls
prgd tokens create claude --agent --cap 500      # agent token, ₺500/month cap
prgd --json servers ls | jq '.[].networks.v4[0].ipAddress'
```

- Config: `~/.config/prgd/config.json` (`PRGD_TOKEN` / `PRGD_API_URL` override).
- Every mutation sends an `Idempotency-Key`; retries are safe.
- `--json` on any command for scripts and agents.
- Windows: same binary, `prgd.exe`, via the releases page (winget/scoop later).

Build: `go build -ldflags "-X main.version=$(git describe --tags --always)" -o prgd .`
Releases: GitHub Actions cross-compiles `linux/darwin/windows × amd64/arm64` on tag push (`.github/workflows/release.yml`).
