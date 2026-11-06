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

The ticket bot runs Codex and browser automation on the host machine. Configure
trusted operators locally; remote pairing and administration are not part of
the current split-role interface. The included browser integration uses a dedicated persistent
browser profile; do not point it at your normal browser profile.

Feishu Browser is used only after the user explicitly enables it. By default the
bridge does not submit forms unless both `feishuBrowser.enabled` and
`feishuBrowser.autoSubmit` are explicitly configured.

## Reporting

Do not open a public issue containing credentials or business data. Revoke the
affected credential first, then report the issue with sanitized reproduction
steps.

## Session and telemetry boundaries

Identity binding does not grant authorization. Buttons are scoped to their creator, conversation, role and expiration; local task clearing cannot delete or undo online records. Original state and diagnostic logs may contain business evidence even though new anonymous statistics exclude message content, images, names and account IDs.

Do not upload anonymous event files or reports to Git either. Suggestions are generated locally and reviewed by a maintainer; the bot does not autonomously change permissions, source tables, code or deployments. See [telemetry](docs/observability.md) and [remote safety](docs/remote-safety.md).
