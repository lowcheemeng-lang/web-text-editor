#!/usr/bin/env node
// Progress reporter for this repo. Dependency-free; run: node scripts/status.mjs
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import { dirname, resolve } from "node:path";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ledger = readFileSync(resolve(ROOT, "PROGRESS.md"), "utf8");

const lines = ledger.split("\n");

/** Return the body lines of a `## Heading` section (until the next `## `). */
function section(title) {
  const start = lines.findIndex((l) => l.trim() === `## ${title}`);
  if (start === -1) return [];
  const out = [];
  for (let i = start + 1; i < lines.length; i++) {
    if (/^##\s/.test(lines[i])) break;
    out.push(lines[i]);
  }
  return out;
}

const MARK = {
  DONE: "\u2705",
  WIP: "\u{1F528}",
  TODO: "\u2B1C",
  BLOCKED: "\u{1F6D1}",
  DEFERRED: "\u23ED ",
};

const rows = section("Status board")
  .filter((l) => /^\|\s*\d+\s*\|/.test(l))
  .map((l) => l.split("|").slice(1, -1).map((c) => c.trim()));

if (rows.length === 0) {
  console.error("No rows found under '## Status board' in PROGRESS.md");
  process.exit(1);
}

const tally = { DONE: 0, WIP: 0, TODO: 0, BLOCKED: 0, DEFERRED: 0 };
console.log("\nTask status  (source: PROGRESS.md)\n");
for (const [num, title, status, evidence, commit] of rows) {
  const key = (status || "TODO").toUpperCase();
  tally[key] = (tally[key] || 0) + 1;
  const mark = MARK[key] || "?";
  console.log(`  ${mark}  Task ${num.padStart(2)}  ${title}`);
  if (evidence && evidence !== "-") console.log(`            evidence: ${evidence}`);
  if (commit && commit !== "-") console.log(`            commit:   ${commit}`);
}

const total = rows.length;
const pct = Math.round((tally.DONE / total) * 100);
console.log(
  `\n  ${tally.DONE}/${total} done (${pct}%)` +
    `   wip:${tally.WIP}  todo:${tally.TODO}  blocked:${tally.BLOCKED}  deferred:${tally.DEFERRED}`,
);

const nextLines = section("Next action")
  .map((l) => l.trim())
  .filter((l) => l && !l.startsWith("<!--") && !l.startsWith(">"));
console.log(`\nNext action\n  ${nextLines[0] || "(none recorded)"}`);

try {
  const head = execSync("git log --oneline -1", { cwd: ROOT, encoding: "utf8" }).trim();
  const dirty = execSync("git status --short", { cwd: ROOT, encoding: "utf8" })
    .split("\n")
    .filter(Boolean);
  console.log(`\nGit\n  HEAD: ${head || "(no commits)"}`);
  console.log(`  uncommitted entries: ${dirty.length}`);
  for (const d of dirty.slice(0, 10)) console.log(`    ${d}`);
} catch {
  console.log("\nGit\n  (not a git repo, or git unavailable)");
}
console.log("");
