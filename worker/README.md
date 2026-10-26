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
src/providers/tencent-docs
                            Tencent Docs draft provider
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

Start the dedicated Edge profile, log in to Feishu, open any record card in the
target task table, then run:

```powershell
node src/scripts/discover-feishu-fields.mjs --config config.json
```

The output is a JSON mapping accepted by `setup.ps1` or can be copied into
`feishuBrowser.fieldIds`.

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
