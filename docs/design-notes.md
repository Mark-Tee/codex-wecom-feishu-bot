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
- Browser failures return the partial state and keep the local task for retry.
- Tencent Docs writes are backed up locally before replacement.
