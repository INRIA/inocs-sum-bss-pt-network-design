#!/usr/bin/env node
/**
 * Safe comparison for the map markup guard (src/components/map/__guard__).
 *
 * The snapshots are single-line HTML files of ~250 KB: printing one, or letting the test runner
 * print a diff of one, floods a terminal. This renders nothing itself — it runs the guard test
 * quietly and, for every snapshot vitest reports as different, prints only the first differing
 * offset with a short window of context from both sides.
 *
 *   node scripts/guard-diff.mjs            # compare, short report
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const guardDir = join(root, 'src/components/map/__guard__');
const outDir = join(root, 'node_modules/.cache/guard-actual');
rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

let ok = true;
try {
  execFileSync('npx', ['vitest', 'run', 'src/components/map/cityMap.guard.test.tsx', '--reporter=json', '--outputFile', join(outDir, 'report.json')], {
    cwd: root,
    stdio: 'ignore',
    env: { ...process.env, GUARD_ACTUAL_DIR: outDir },
  });
} catch {
  ok = false;
}

const report = existsSync(join(outDir, 'report.json')) ? JSON.parse(readFileSync(join(outDir, 'report.json'), 'utf8')) : null;
const tests = report?.testResults?.flatMap((f) => f.assertionResults) ?? [];
for (const t of tests) console.log(`${t.status === 'passed' ? 'PASS' : 'FAIL'}  ${t.title}`);
if (!tests.length) console.log('no test result parsed — the guard file may not compile; run: npx vitest run src/components/map/cityMap.guard.test.tsx 2>&1 | tail -c 2000');

for (const name of readdirSync(guardDir)) {
  const actualPath = join(outDir, name);
  if (!existsSync(actualPath)) continue;
  const a = readFileSync(join(guardDir, name), 'utf8');
  const b = readFileSync(actualPath, 'utf8');
  if (a === b) continue;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  const w = 160;
  console.log(`\nDIFF ${name}: expected ${a.length} chars, actual ${b.length}; first difference at offset ${i}`);
  console.log(`  expected: …${a.slice(Math.max(0, i - 60), i + w)}…`);
  console.log(`  actual  : …${b.slice(Math.max(0, i - 60), i + w)}…`);
}
console.log(ok ? '\nguard: all snapshots match' : '\nguard: MISMATCH (see above)');
process.exit(ok ? 0 : 1);
