import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const testDirs = [
  path.join(process.cwd(), "tests"),
  path.join(process.cwd(), "worker", "tests"),
];
const files = testDirs.flatMap((testDir) => {
  let names = [];
  try {
    names = fs.readdirSync(testDir);
  } catch {
    return [];
  }
  return names
    .filter((name) => /\.test\.(?:mjs|cjs)$/.test(name))
    .sort()
    .map((name) => path.join(testDir, name));
});

const result = spawnSync(process.execPath, ["--test", ...files], {
  stdio: "inherit",
  windowsHide: true,
});
process.exit(result.status ?? 1);
