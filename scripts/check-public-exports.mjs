/**
 * Public-export audit against a reviewed baseline.
 *
 * `pnpm knip` cannot see unused exported symbols in published packages: each
 * library's `src/*.{ts,tsx}` barrel is an entry file, `includeEntryExports` is
 * disabled, and the `exports`/`types` rules are off. That is how the unused
 * `toSerializableCollection()` helper survived to 4.11. `knip.exports.json`
 * re-enables all three for `packages/*`.
 *
 * Run on its own that audit reports ~1000 findings, because knip asks only
 * "does anything else in this monorepo import it?" — which is false for most
 * deliberate public API. The volume would hide a new finding rather than
 * surface it.
 *
 * So this script diffs the audit against `knip.exports.baseline.json`, the
 * enumerated snapshot of the known public surface, and reports only what the
 * baseline does not already contain. A newly added export that nothing
 * consumes fails the check; everything already recorded stays quiet.
 *
 * The baseline records the surface — it does not assert that every entry was
 * individually judged worth keeping. Prune entries as packages get reviewed;
 * the check reports stale ones to make that easy.
 *
 *   node scripts/check-public-exports.mjs            # verify against baseline
 *   node scripts/check-public-exports.mjs --update   # rewrite the baseline
 */

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'

const BASELINE_PATH = 'knip.exports.baseline.json'
const update = process.argv.includes('--update')

const findings = runAudit()

if (update) {
  writeFileSync(
    BASELINE_PATH,
    `${JSON.stringify(
      {
        description:
          'Reviewed baseline of exported symbols in published packages with no consumer inside this repository. Most are deliberate public API. Regenerate with `pnpm knip:exports:update`; see scripts/check-public-exports.mjs.',
        entries: findings,
      },
      null,
      2
    )}\n`
  )
  console.log(`public-export baseline updated: ${findings.length} entr(ies) recorded`)
  process.exit(0)
}

if (!existsSync(BASELINE_PATH)) {
  fail(`missing ${BASELINE_PATH} — generate it with \`pnpm knip:exports:update\``)
}

const baseline = new Set(JSON.parse(readFileSync(BASELINE_PATH, 'utf8')).entries)
const current = new Set(findings)

const added = findings.filter((entry) => !baseline.has(entry))
const stale = [...baseline].filter((entry) => !current.has(entry)).sort()

if (stale.length > 0) {
  console.log(
    `note: ${stale.length} baseline entr(ies) no longer reported (export removed, or now consumed).`
  )
  console.log('      Run `pnpm knip:exports:update` to prune them.')
}

if (added.length > 0) {
  fail(
    [
      `${added.length} exported symbol(s) in published packages have no consumer in this repository:`,
      ...added.map((entry) => `  - ${describe(entry)}`),
      '',
      'Each is either dead code to delete, or deliberate public API. If it is',
      'public API, record it with `pnpm knip:exports:update` and mention why in',
      'the commit message.',
    ].join('\n')
  )
}

console.log(
  `public-export audit passed: ${findings.length} known entr(ies), no new unconsumed exports`
)

function runAudit() {
  const result = spawnSync(
    'pnpm',
    [
      'exec',
      'knip',
      '--config',
      'knip.exports.json',
      '--workspace',
      './packages/*',
      '--no-config-hints',
      '--no-exit-code',
      '--max-show-issues',
      '100000',
      '--reporter',
      'json',
    ],
    { cwd: process.cwd(), encoding: 'utf8', maxBuffer: 128 * 1024 * 1024 }
  )

  if (result.error) fail(`failed to run knip: ${result.error.message}`)

  const start = result.stdout.indexOf('{')
  if (start < 0) {
    fail(`knip produced no JSON output:\n${result.stdout}\n${result.stderr}`)
  }

  let report
  try {
    report = JSON.parse(result.stdout.slice(start))
  } catch (error) {
    fail(`could not parse knip JSON output: ${error.message}`)
  }

  // Key on file + kind + name only. Line and column churn on every unrelated
  // edit and would invalidate the whole baseline on a formatting change.
  const entries = []
  for (const issue of report.issues ?? []) {
    for (const item of issue.exports ?? []) entries.push(`${issue.file}|export|${item.name}`)
    for (const item of issue.types ?? []) entries.push(`${issue.file}|type|${item.name}`)
  }
  return [...new Set(entries)].sort()
}

function describe(entry) {
  const [file, kind, name] = entry.split('|')
  return `${name} (${kind}) — ${file}`
}

function fail(message) {
  console.error(message)
  process.exit(1)
}
