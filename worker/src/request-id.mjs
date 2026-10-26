import crypto from "node:crypto";

export function requestId(prefix = "id") {
  return `${prefix}_${crypto.randomUUID()}`;
}
