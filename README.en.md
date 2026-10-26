# codex-wecom-feishu-bot

Self-hosted automation linking WeCom, Codex, Feishu Base and Tencent Docs.

The bot receives work orders from a WeCom intelligent bot, uses local Codex to
extract fields, verifies identifiers, fills and submits a Feishu Base record
through a dedicated Edge profile, then updates Tencent Docs after `/done`.

## Requirements

- Windows with PowerShell
- Node.js 22+
- Codex CLI, installed and authenticated
- WeCom intelligent bot BotID and long-connection Secret
- A Feishu Base record URL and task-location options
- Tencent Docs token and source/draft file IDs for the optional `/done` stage

## Quick start

```powershell
git clone https://github.com/Mark-Tee/codex-wecom-feishu-bot.git
cd codex-wecom-feishu-bot
.\setup.cmd
.\doctor.cmd
.\start.cmd
```

The setup wizard opens the dedicated Edge profile, waits for Feishu login when
needed, discovers field IDs and the all-tasks view, and writes them without
manual JSON editing.

## Real-table E2E

Preview the target fingerprint without writing:

```powershell
node worker/src/scripts/benchmark-feishu-e2e.mjs --config worker/config.e2e.json --runs=10
```

For a dedicated test table only:

```powershell
node worker/src/scripts/benchmark-feishu-e2e.mjs --config worker/config.e2e.json --runs=10 `
  --execute --confirm-table=<targetFingerprint>
```

The report includes success rate, P50, P95, maximum latency, and failure stages.
The default gate is at least 90% success and P95 below 60 seconds.

For maintainer notifications, a one-shot private sender accepts a user ID and a
local message file:

```powershell
node scripts/send-wecom-private.cjs --config config.json `
  --user <wecom-user-id> --message-file <local-message-file>
```

## Commands

| Command | Purpose |
|---|---|
| `/pair <code>` | Pair a WeCom user |
| `/new` | Reset the Codex thread |
| `/status` | Show health and queue state |
| `/pending` | List pending work orders |
| `/fill <id>` | Retry Feishu filling |
| `/cancel <id>` | Cancel a pending local task |
| `/done <id>` | Update the Tencent Docs draft |

The local short ID is the final three digits of the Feishu task-list number with
leading zeros removed. For example, `WN20261026006` maps to `6`.

Hot-topic crawling is disabled by default. Legacy Feishu Open API code is
isolated under `worker/src/legacy/` and is not used by the browser creation path.

See [SECURITY.md](SECURITY.md) before exposing the bot to other users.
