import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync } from 'node:fs'
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
  if (adapters.join(',') !== 'mysql') fail('expected only the bundled MySQL baseline')

  const expected = adapters.flatMap((adapter) => {
    const directory = resolve(migrationsRoot, adapter)
    // Release baselines are normally squashed to one SQL file, but a
    // development branch may add migrations before the release squash.
    const sql = readdirSync(directory)
      .filter((name) => name.endsWith('.sql'))
      .sort()
    if (sql.length === 0) {
      fail(`no bundled ${adapter} SQL baseline found`)
    }
    return [
      ...sql.map((name) => `package/dist/templates/migrations/${adapter}/${name}`),
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

  if (entries.some((entry) => entry.includes('/templates/migrations/postgres/')))
    fail('stale PostgreSQL CLI baseline')
  const consumer = resolve(destination, 'consumer')
  const postgresRoot = resolve(cliRoot, '../db-postgres')
  const adapterTarballs = resolve(destination, 'adapter-tarballs')
  mkdirSync(adapterTarballs)
  run(packageManagerCommand(), ['pack', '--pack-destination', adapterTarballs], postgresRoot)
  const adapterArchive = readdirSync(adapterTarballs).filter((name) => name.endsWith('.tgz'))
  if (adapterArchive.length !== 1) fail('expected one PostgreSQL adapter tarball')
  const installed = resolve(consumer, 'node_modules/@byline')
  for (const [name, tarball] of [
    ['cli', archive],
    ['db-postgres', resolve(adapterTarballs, adapterArchive[0])],
  ]) {
    const dir = resolve(installed, name)
    mkdirSync(dir, { recursive: true })
    run('tar', ['-xzf', tarball, '--strip-components=1', '-C', dir], consumer)
  }
  const manifest = (name) =>
    JSON.parse(readFileSync(resolve(installed, name, 'package.json'), 'utf8'))
  if (manifest('cli').dependencies['@byline/db-postgres'] !== manifest('db-postgres').version) {
    fail('packed CLI must depend on the exact packed adapter')
  }
  // Supply only external driver dependencies. CLI and adapter code and assets must
  // resolve from the extracted packages; no host config or workspace link exists.
  symlinkSync(resolve(postgresRoot, 'node_modules/pg'), resolve(consumer, 'node_modules/pg'), 'dir')
  symlinkSync(
    resolve(cliRoot, 'node_modules/semver'),
    resolve(consumer, 'node_modules/semver'),
    'dir'
  )
  run(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      "const { postgresProvisioner } = await import('./dist/lib/database/postgres.js'); await postgresProvisioner.verifyBaselineAssets()",
    ],
    resolve(installed, 'cli')
  )

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
