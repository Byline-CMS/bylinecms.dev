import { spawnSync } from 'node:child_process'
import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const cliRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const migrationsRoot = resolve(cliRoot, 'src/templates/migrations')
const destination = mkdtempSync(resolve(tmpdir(), 'byline-cli-pack-'))

try {
  run(packageManagerCommand(), ['pack', '--pack-destination', destination], cliRoot)
  const archives = readdirSync(destination).filter((name) => name.endsWith('.tgz'))
  if (archives.length !== 1) {
    fail(`expected one CLI package archive, found ${archives.length}`)
  }

  const archive = resolve(destination, archives[0])
  const entries = run('tar', ['-tzf', archive], cliRoot).split('\n').filter(Boolean)

  const adapters = readdirSync(migrationsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
  if (adapters.length === 0) fail('no bundled database baselines found')

  const expected = adapters.flatMap((adapter) => {
    const directory = resolve(migrationsRoot, adapter)
    const sql = readdirSync(directory).filter((name) => name.endsWith('.sql'))
    if (sql.length !== 1) {
      fail(`expected one bundled ${adapter} SQL baseline, found ${sql.length}`)
    }
    return [
      `package/dist/templates/migrations/${adapter}/${sql[0]}`,
      `package/dist/templates/migrations/${adapter}/meta/_journal.json`,
    ]
  })

  const missing = expected.filter((entry) => !entries.includes(entry))
  if (missing.length > 0) {
    fail(`CLI package archive is missing:\n${missing.map((entry) => `  - ${entry}`).join('\n')}`)
  }

  const snapshots = entries.filter(
    (entry) => entry.includes('/templates/migrations/') && /snapshot/i.test(basename(entry))
  )
  if (snapshots.length > 0) {
    fail(
      `CLI package archive must not contain Drizzle snapshots:\n${snapshots
        .map((entry) => `  - ${entry}`)
        .join('\n')}`
    )
  }

  console.log(`CLI package artifact passed: ${expected.length} baseline file(s), no snapshots`)
} finally {
  rmSync(destination, { recursive: true, force: true })
}

function packageManagerCommand() {
  return process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
}

function run(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
  })
  if (result.status !== 0) {
    fail(
      `${command} ${args.join(' ')} failed${
        result.stderr?.trim() ? `:\n${result.stderr.trim()}` : ''
      }`
    )
  }
  return result.stdout ?? ''
}

function fail(message) {
  throw new Error(message)
}
