import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const cwd = fileURLToPath(new URL('..', import.meta.url))
const previous = process.env.BYLINE_TEST_PREVIOUS_RELEASE ?? '6.13.4'
if (!/^\d+\.\d+\.\d+$/.test(previous)) throw Error('Expected an exact prior release version')
const directory =
  process.env.BYLINE_TEST_RELEASE_DIRECTORY ??
  mkdtempSync(join(tmpdir(), 'byline-postgres-previous-'))
function run(program, args, options) {
  const result = spawnSync(program, args, { stdio: 'inherit', ...options })
  if (result.error) throw result.error
  if (result.status !== 0) throw Error(`${program} failed`)
}
try {
  const packages = ['@byline/auth', '@byline/client', '@byline/core', '@byline/db-postgres']
  if (!process.env.BYLINE_TEST_RELEASE_DIRECTORY)
    run(
      'npm',
      [
        'install',
        '--ignore-scripts',
        '--no-audit',
        '--no-fund',
        '--save-exact',
        ...packages.map((p) => `${p}@${previous}`),
      ],
      { cwd: directory }
    )
  const lock = JSON.parse(readFileSync(join(directory, 'package-lock.json'), 'utf8'))
  for (const p of packages) {
    const entry = lock.packages[`node_modules/${p}`]
    const installed = JSON.parse(
      readFileSync(join(directory, 'node_modules', p, 'package.json'), 'utf8')
    )
    if (
      installed.name !== p ||
      installed.version !== previous ||
      entry.version !== previous ||
      !entry.integrity ||
      entry.link
    )
      throw Error(`Expected published ${p}@${previous}`)
  }
  run('pnpm', ['exec', 'vitest', 'run', '--mode=compatibility', '--silent=false'], {
    cwd,
    env: { ...process.env, BYLINE_TEST_RELEASE_DIRECTORY: directory },
  })
} finally {
  if (!process.env.BYLINE_TEST_RELEASE_DIRECTORY)
    rmSync(directory, { recursive: true, force: true })
}
