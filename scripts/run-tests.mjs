import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const testDir = path.join(process.cwd(), "worker", "tests");
const files = fs.readdirSync(testDir)
  .filter((name) => name.endsWith(".test.mjs"))
  .sort()
  .map((name) => path.join(testDir, name));

const result = spawnSync(process.execPath, ["--test", ...files], {
  stdio: "inherit",
  windowsHide: true,
});
process.exit(result.status ?? 1);
