# prgd-mcp

An MCP server that turns the prgd API into tools for Claude Code, Cursor, Windsurf, n8n or any other MCP client.

## Setup

1. Create an agent token with a spending cap (console → Managed Agents → Agent Access, or the CLI):

   ```sh
   prgd tokens create claude --agent --cap 15      # $15 per month, delete needs approval
   ```

2. Add the server to your client:

   ```sh
   claude mcp add prgd -e PRGD_TOKEN=prgd_... -- npx -y prgd-mcp
   ```

   Cursor or Windsurf (`mcp.json`):

   ```json
   { "mcpServers": { "prgd": { "command": "npx", "args": ["-y", "prgd-mcp"], "env": { "PRGD_TOKEN": "prgd_..." } } } }
   ```

   If you already ran `prgd login`, the server reads the token and API URL from `~/.config/prgd/config.json`, so no env is needed.

3. Ask: "Deploy https://github.com/me/app on the smallest server and give me the URL."

## Tools

| Tool | What it does |
|---|---|
| `list_servers`, `get_server` | Inventory and status, including recent actions |
| `list_sizes`, `list_images` | Catalog with prices (USD or SAR) and marketplace apps |
| `create_server` | Creates a server and waits until it is active |
| `server_action` | start, stop, reboot, resize, rebuild, snapshot |
| `delete_server` | Requires `confirm: true`; usually needs a human to approve |
| `deploy_repository`, `list_deployments`, `redeploy` | Git Deploy |
| `get_billing` | Balance, month to date, and what this token may still spend |
| `list_firewalls` | Firewall rules |

## Safety model

The MCP server has no policy of its own. The API enforces the token's scopes, monthly spending cap and approval rules, and returns clear errors (`spend_limit_reached`, `forbidden`, `approval_required`) that the server passes back to the agent as text with a hint on what to do. Give an agent a token with a cap and it cannot spend past it, whatever it is asked.

Deployments: `list_github_repos` shows what the team's GitHub App installations can reach; `deploy_repository` takes either a public `repoUrl` or `installationId` + `repo`; `deploy_logs` returns the build log so the agent can fix a failing build.

When a token has approval rules (for example `servers:delete`), the matching call is parked instead of run. The agent gets an `approval_required` error with the approval id, the team owners get an email and a webhook event, and the request shows up under Managed Agents, Approval Queue in the console. The agent can call `get_approval` (with `wait: true` to poll for up to ten minutes) to learn the decision; an approved request has already run by then.

## Development

```sh
pnpm --filter prgd-mcp build
PRGD_API_URL=http://localhost:4000 PRGD_TOKEN=prgd_... node packages/mcp-server/dist/index.js
```
