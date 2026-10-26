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
- A Feishu Base record URL, field mapping and an Edge profile logged in to Feishu
- Tencent Docs token and source/draft file IDs for the optional `/done` stage

## Quick start

```powershell
git clone https://github.com/Mark-Tee/codex-wecom-feishu-bot.git
cd codex-wecom-feishu-bot
.\setup.cmd
.\doctor.cmd
.\start.cmd
```

Use `worker/src/scripts/discover-feishu-fields.mjs` to generate the Feishu field
map after logging in with the dedicated Edge profile.

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

See [SECURITY.md](SECURITY.md) before exposing the bot to other users.
