# Duty Worker

The worker is invoked by the root `bridge.cjs` for work orders and `/done`.

## Files

```text
config.example.json         Example bridge-to-worker configuration
duty-config.example.json    Example Feishu/Tencent workflow configuration
src/scripts/handle-wecom-message.mjs
                            One-shot JSON stdin/stdout entry point
src/platforms/feishu-browser
                            Edge/CDP browser automation
src/scripts/benchmark-feishu-e2e.mjs
                            Guarded real-table 10-run benchmark
src/providers/tencent-docs
                            Tencent Docs draft provider
src/legacy
                            Opt-in historical Feishu Open API code
```

## Runtime Files

Do not commit:

```text
config.json
duty-config.json
state.json
data/
logs/
```

## Feishu Field Discovery

The root setup wizard runs discovery automatically. For a manual read-only check:

```powershell
node src/scripts/discover-feishu-fields.mjs --config config.json --check
```

The command may open a blank record form to inspect labels, but does not fill or
submit it. Add `--write` to save discovered field and view IDs into the local
config. Add `--no-open` when a record card is already open. The check output
contains counts only, not table credentials or IDs.

## Worker Protocol

The root bridge sends one JSON message on stdin and expects:

```json
{
  "replies": [
    {
      "kind": "final",
      "text": "result"
    }
  ]
}
```

Logs are written to stderr so stdout remains valid JSON.

## Tests

From the repository root:

```powershell
npm test
```
