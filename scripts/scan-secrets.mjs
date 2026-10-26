import fs from "node:fs";
import { execFileSync } from "node:child_process";

const output = execFileSync(
  "git",
  ["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
  { encoding: "utf8" },
);
const files = output.split("\0").filter(Boolean);

const rules = [
  {
    id: "private-key",
    pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  },
  {
    id: "github-token",
    pattern: /\b(?:ghp_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})\b/,
  },
  {
    id: "openai-token",
    pattern: /\bsk-(?:proj-)?[A-Za-z0-9_-]{24,}\b/,
  },
  {
    id: "slack-token",
    pattern: /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/,
  },
  {
    id: "cloud-access-key",
    pattern: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/,
  },
  {
    id: "feishu-or-base-id",
    pattern: /\b(?:tbl|fld|vew|rec)[A-Za-z0-9]{16,}\b/,
  },
  {
    id: "credential-assignment",
    pattern: /["']?(?:botId|secret|appSecret|tenant_access_token|TENCENT_DOCS_TOKEN)["']?\s*[:=]\s*["'][A-Za-z0-9+/_=-]{16,}["']/i,
  },
];

const findings = [];
for (const file of files) {
  if (
    /(?:^|\/)(?:logs?|data|screenshots?)\//i.test(file)
    || /(?:^|\/)(?:state|system-info)\.json$/i.test(file)
  ) {
    findings.push({
      rule: "tracked-runtime-data",
      file,
      line: 1,
    });
  }
  if (
    file.startsWith("vendor/")
    || file.startsWith("worker/node_modules/")
    || file.endsWith("package-lock.json")
  ) {
    continue;
  }
  let text = "";
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    continue;
  }
  const lines = text.split(/\r?\n/);
  for (const rule of rules) {
    for (let index = 0; index < lines.length; index += 1) {
      const match = lines[index].match(rule.pattern);
      if (!match) continue;
      if (
        /\.test\.(?:mjs|cjs)$/i.test(file)
        && /Example|Placeholder/i.test(match[0])
      ) {
        continue;
      }
      findings.push({
        rule: rule.id,
        file,
        line: index + 1,
      });
    }
  }
}

if (findings.length) {
  process.stderr.write("Sensitive-information scan failed.\n");
  for (const finding of findings) {
    process.stderr.write(`- ${finding.rule}: ${finding.file}:${finding.line}\n`);
  }
  process.exitCode = 1;
} else {
  process.stdout.write(JSON.stringify({
    ok: true,
    filesScanned: files.length,
    rules: rules.map((rule) => rule.id),
  }, null, 2));
}
