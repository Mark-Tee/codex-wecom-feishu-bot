# Design Notes

## Why a long connection

The WeCom intelligent bot uses an outbound WebSocket. This avoids public webhook
exposure, port forwarding, and inbound firewall changes.

## Task flow

1. The bridge verifies the paired WeCom user.
2. Normal chat is executed by `codex exec` and resumed by thread ID.
3. Work orders are routed to the local duty worker.
4. The worker extracts fields, validates identifiers, and controls the dedicated
   Edge profile.
5. The browser filler reads the current Feishu task sequence, creates one new
   record, verifies every field, and submits only after verification.
6. The final response returns the Feishu task number and `/done` short ID.

## Short ID

The short ID is the last three digits of the Feishu task-list number with leading
zeros removed:

```text
WN20261026006 -> 6
WN20261026012 -> 12
```

## Concurrency

- Chat sessions are isolated by chat ID.
- The task queue is serial on the host.
- Feishu task numbers are read immediately before creating a record.
- A second read occurs before submission.
- Existing record cards are never reused.

## Failure handling

- Configuration and field validation failures stop before browser submission.
- Browser failures return the partial state, stage code, elapsed time, and an
  ignored local screenshot path, and keep the local task for retry.
- Tencent Docs writes are backed up locally before replacement.

## Module boundaries

- `bridge.cjs` orchestrates WeCom messages, Codex jobs, and the local task queue.
- `lib/wecom-long-connection.cjs` owns authentication, ACK routing, heartbeat,
  and reconnect backoff.
- `lib/usage-tracker.cjs`, `lib/answer-cache.cjs`, and `lib/help-router.cjs`
  contain side-effect-focused helpers.
- `lib/hot-topics.cjs` is optional and disabled unless explicitly configured.
- `worker/src/platforms/feishu-browser` owns all browser automation.
- `worker/src/legacy/feishu-base` is historical Open API code and is not imported
  by the default runtime.
