# Security

## Never Commit

- WeCom BotID or long-connection Secret
- Tencent Docs access tokens
- Feishu or Lark application credentials
- Browser profile cookies, databases, or storage state
- Real business tables, documents, screenshots, chat logs, or employee data

The repository ignores `config.json`, `worker/config.json`, `worker/duty-config.json`,
`.env`, runtime state, logs, and downloaded media.

Browser failure screenshots are written under the ignored
`data/feishu-browser-diagnostics` directory. Review and delete them locally
according to the deployment's data-retention policy; never attach them to a
public issue.

## Trust Boundary

This bot runs Codex and browser automation on the host machine. Only pair WeCom
users you trust. The included browser integration uses a dedicated persistent
browser profile; do not point it at your normal browser profile.

Feishu Browser is used only after the user explicitly enables it. By default the
bridge does not submit forms unless both `feishuBrowser.enabled` and
`feishuBrowser.autoSubmit` are explicitly configured.

## Reporting

Do not open a public issue containing credentials or business data. Revoke the
affected credential first, then report the issue with sanitized reproduction
steps.
