# Duty Worker

The integrated ticket bridge invokes `src/scripts/handle-wecom-message.mjs` once per business request. The roster bot imports read-only scheduling modules and does not invoke the ticket worker or model runner. Short Chinese commands are normalized in the bridge; the worker consumes the internal command protocol.

## Module map

| Path | Responsibility |
|---|---|
| `src/scripts/handle-wecom-message.mjs` | JSON stdin/stdout process boundary |
| `src/runtime/conversation-service.mjs` | Sender/session isolation, clarification and workflow routing |
| `src/runtime/pending-task-store.mjs` | Pending tasks and cancellation guards |
| `src/runtime/observation.mjs` | Allowlisted outcome and failure classifications |
| `src/runtime/help-entries.mjs` | Help entries and limitations |
| `src/core` | Duty, site, date, identifier and draft rules |
| `src/providers/tencent-docs` | Source reads and guarded fixed-draft writes |
| `src/platforms/feishu-browser` | Authorized Edge/CDP filling, deduplication and readback |
| `src/legacy` | Historical API code, not the default record-creation path |

`config.example.json` and `duty-config.example.json` are templates. Real configuration, state, browser profiles, screenshots and generated files are ignored and must not be committed. The worker state contains original business evidence; the new anonymous statistics policy does not make that state non-sensitive.

## Process protocol

One message arrives as JSON on stdin. Stdout is one JSON result:

```json
{
  "replies": [{"kind": "final", "text": "result"}],
  "observations": ["clarification"],
  "errors": []
}
```

The arrays above illustrate the schema, not an actual registration result. A reply may carry `action: {kind: "forget-confirm", token: "..."}` for a locally pinned clear preview. The bridge validates and converts it to a card; never display or accept arbitrary event commands.

Stderr carries diagnostics and allowlisted `@@BOT_STAGE` records (`recognizing`, `checking`). Neither a zero exit code nor a final reply alone proves a saved record. `registration_verified` requires record mode, successful submission, field verification and completion of submission readback; unverified submissions and draft repository returns have distinct outcomes.

## Behavior and safe maintenance

Ordinary work orders produce Feishu records; confirmed submission followed by `/done` generates fixed Tencent drafts. Power-duty records leave both person fields blank and skip Tencent drafts. `/forget` stops local tracking within the sender's current session, retains prevention state and never reverses online writes. Uncertain writes require local review before another attempt.

For field discovery from this directory:

```powershell
node src/scripts/discover-feishu-fields.mjs --config config.json --check
```

This may inspect a blank form but does not submit. `--write` saves local discovered configuration; run only as a maintainer. Test the configured process entry from an isolated synthetic working directory after deployment so production `state.json` is never used for smoke tests.

Run `npm test` from the repository root. Offline regressions do not establish real image latency or online end-to-end acceptance. See [project status](../docs/PROJECT_STATUS.md), [architecture](../docs/design-notes.md), [clear semantics](../docs/clear-own-tasks.md) and [anonymous statistics](../docs/observability.md).
