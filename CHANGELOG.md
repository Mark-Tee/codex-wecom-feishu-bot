# Changelog

## Unreleased — current repair branch (2026-11-03)

- Separate read-only roster and ticket roles, credentials, state, ports and startup tasks; retain combined only for legacy compatibility.
- Add sender/conversation isolation, short commands, role-specific button menus and single-stream ticket progress, including nested callback/ACK handling.
- Add schedule/leave queries, latest-source 07:00/17:00 broadcasts and private power-duty handoff simulations.
- Keep local-only administration, own-session clear previews, consumed confirmation guards and online-history preservation.
- Preserve Feishu target checks, composite identifier deduplication, submission readback and guarded Tencent draft append/review behavior.
- Add hidden logon guardian, reconnect/health handling, bounded local logs and anonymous allowlisted usage/error reports with rule-based suggestions.
- Replace historical README and module instructions with current command, protocol, deployment, cost and acceptance boundaries. Actual buttons/broadcasts were tested; sustained reliability and the sub-minute/ten-run target remain unaccepted.
- No runtime records, credentials, telemetry data or employee information are included in the public source. Features on this branch are not necessarily merged into the default branch.

## 0.1.0

- Initial public release.
- WeCom long-connection bot with pairing, queues, context and streaming progress.
- Work-order OCR and Codex parsing.
- Feishu Base browser filling with automatic verification and submission.
- Task-list suffix short IDs and duplicate-safe task reassignment.
- `/done` support for updating Tencent Docs drafts.
