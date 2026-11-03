# codex-wecom-feishu-bot

[简体中文](README.md) | [English](README.en.md)

Self-hosted Windows bots for WeCom, read-only duty schedules, Feishu registration through a dedicated Edge profile, and fixed Tencent Docs drafts. No Feishu API permission is required for the browser path.

This documentation describes the current repair branch as of 2026-11-03. Unmerged features may be absent from the default branch. This is a controlled trial, not a production reliability certification or an official vendor project.

## Two independent services

| Role | Entry | Purpose |
|---|---|---|
| `roster` | `roster-bot.cjs` | Schedule queries, leave candidates, group broadcasts, private power-duty handoff drafts |
| `ticket` | `bridge.cjs` | Images, clarification, Feishu records, personal pending tasks and Tencent drafts |

Use separate BotIDs, credentials, directories, states, ports and logon tasks. Each instance has one connected bot process and one guardian. The example configuration still defaults to legacy `combined`; the setup wizard does not configure two independent services for you.

## Commands

In a group, mention the intended bot; in private chat, send directly. Mention-only or `菜单` opens buttons; a platform success toast alone is not a query result.

| Role | Input | Meaning |
|---|---|---|
| Roster | `班`, `今`, `明` | Today/tomorrow, today, tomorrow |
| Roster | `我 姓名`, `我` | Bind/check your own identity; e.g. `我 测试甲` |
| Roster | `休`, `休下月`, `休2026-12` | Eligible scheduled workdays; not leave approval |
| Roster | `休明`, `休2026-11-04` | Check one date |
| Roster | `推送`, `交班` | Broadcast and personal handoff status |
| Ticket | Work-order image | Extract fields; confirm uncertain text before writing |
| Ticket | `人 姓名`, `单`, `继续`, `补 内容` | Identity, pending tasks, clarification |
| Ticket | `填12`, `完12` | Retry filling; generate fixed drafts after confirmed Feishu submission |
| Ticket | `清10`, `清全部` | Stop your local tracking; bulk clear requires a pinned confirmation |
| Both | `菜单`, `状态` | Help and status |

Identities and tasks are separated by sender and conversation. Group and private tasks do not mix. Clearing does not undo Feishu/Tencent writes; selecting “keep” after an executed clear cannot undo it. Remote administration, source-file edits, authorization, process stopping and broadcast binding are local-maintenance tasks.

Roster broadcasts read the latest source at 07:00 for today and 17:00 for tomorrow. Interactive results prioritize the bound requester; scheduled results remain global. Night duty, daytime primary duty and remote network slot 1 restrict leave. Empty cells without another explicit assignment mean rest. Power-duty handoff simulation drafts are sent privately at 16:30 or the next morning at 07:30 and need review before handoff.

Ordinary workflow: image → clarification → configured Feishu fill/verification/submission → `完12` → fixed Tencent drafts. Power duty is determined from the received-time roster, leaves both person fields empty and does not require `完`. Official Tencent source tables are not changed automatically. Existing draft handover rows require local review; append operations check full-row occupancy, back up and read back.

## Setup

Requires Windows/PowerShell, Node.js 22+, authenticated Codex CLI and WeCom long-connection credentials. Browser work requires an authorized dedicated Edge login; Tencent features require a local token and source/draft configuration.

```powershell
git clone https://github.com/Mark-Tee/codex-wecom-feishu-bot.git
cd codex-wecom-feishu-bot
.\setup.cmd
.\doctor.cmd
```

Check out the reviewed revision before setup. The wizard generates ignored local configurations and may inspect an empty Feishu form without submitting it. Configure two separate service directories, explicit roles, unique health/guardian ports and task names. Set `allowUsers` locally; an empty list uses existing local operator state, not unrestricted ticket access. Roster uses `roster.rulesRoot`/`businessConfigPath`; ticket uses `dutyAgent`. Automatic submission requires explicit browser enablement, auto-fill and auto-submit settings.

```powershell
.\start.cmd
powershell -NoProfile -ExecutionPolicy Bypass -File .\install-autostart.ps1
```

`start.cmd` launches the hidden guardian. Logon installation uses the current user's scheduled task, with a Startup shortcut fallback. It is not a SYSTEM service. `stop.ps1` stops only its own instance and disables its task. Never reuse a BotID in another instance.

## Safety, telemetry and costs

Business deduplication uses both identifiers when both exist, otherwise the one available identifier. Existing record cards must never be reused. Incomplete scans, uncertain submissions or wrong targets require local review, not blind retries. Names and IDs must not be invented from unclear images.

Local anonymous reports at `logs/observability/report.md` contain command categories, counts, durations, typed outcomes and error categories. New telemetry excludes content, images, names and account IDs; original business state and diagnostic logs can still contain sensitive data. Reports refresh within a minute of new events, use bounded logs (about 6MiB per service), and generate rule-based suggestions only. No automatic code modification or deployment is performed.

No additional hosted service fee is introduced when reusing the existing computer. Schedule/menu/guardian/statistics logic makes no model calls. Ticket recognition and development still use existing model quota, hardware, electricity, network and maintenance; monthly total usage and proxy traffic have not been measured.

## Acceptance and development

Actual schedule broadcasts and concrete button query results were user-tested; bounded Feishu and Tencent exercises exist. Fresh normal work orders, multi-user concurrency, handoff delivery in a natural shift, Windows logon/restart, network recovery and sustained reliability still need acceptance. The sub-minute target and an independent-table ten-run benchmark are not proven. Existing received-time completion inference remains a business limitation.

```powershell
npm run check
npm test
npm run scan:secrets
node worker/src/scripts/benchmark-feishu-e2e.mjs --config worker/config.e2e.json --runs=10
node worker/src/scripts/benchmark-feishu-e2e.mjs --help
```

The benchmark previews without writes by default. Executing requires a dedicated authorized test table, its fingerprint, `--execute` and `--record`; inspect uncertain in-flight results before resuming. Do not use a shared production table as a substitute.

Read the [architecture](docs/design-notes.md), [worker protocol](worker/README.md), [acceptance status](docs/PROJECT_STATUS.md), [telemetry boundaries](docs/observability.md) and [security policy](SECURITY.md). Runtime data and real credentials never belong in Git. MIT: [LICENSE](LICENSE).

Input defenses validate payloads before media/model work, bound admission and downloads, block private-address image fetches, and restrict extraction tools. See [scope, limits and costs](docs/input-defense.md); this does not establish OS isolation or harden every legacy entry.
