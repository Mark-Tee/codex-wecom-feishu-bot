# Changelog

## Unreleased

- Split the bridge into long-connection, usage, cache, help, and optional
  hot-topic modules while preserving queue, pairing, context, and streaming
  behavior.
- Add Feishu field and all-tasks-view auto-discovery.
- Add staged browser failure diagnostics with local screenshots.
- Add a guarded real-table 10-run E2E benchmark with success rate, P50, P95,
  maximum latency, and failure-stage reporting.
- Simplify first-run setup so field JSON no longer has to be edited by hand.
- Disable hot-topic crawling by default and isolate legacy Feishu Open API code.
- Add tracked-file sensitive-information scanning to CI.

## 0.1.0

- Initial public release.
- WeCom long-connection bot with pairing, queues, context and streaming progress.
- Work-order OCR and Codex parsing.
- Feishu Base browser filling with automatic verification and submission.
- Task-list suffix short IDs and duplicate-safe task reassignment.
- `/done` support for updating Tencent Docs drafts.
