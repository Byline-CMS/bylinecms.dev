import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const cliRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const destination = mkdtempSync(resolve(tmpdir(), 'byline-cli-pack-'))

try {
  run(packageManagerCommand(), ['pack', '--pack-destination', destination], cliRoot)
  const archives = readdirSync(destination).filter((name) => name.endsWith('.tgz'))
  if (archives.length !== 1) {
    fail(`expected one CLI package archive, found ${archives.length}`)
  }

  const archive = resolve(destination, archives[0])
  const entries = run('tar', ['-tzf', archive], cliRoot).split('\n').filter(Boolean)

  if (entries.some((entry) => entry.includes('/templates/migrations/')))
    fail('the packed CLI contains obsolete migration templates')
  const consumer = resolve(destination, 'consumer')
  const installed = resolve(consumer, 'node_modules/@byline')
  function unpack(name, tarball) {
    const dir = resolve(installed, name)
    mkdirSync(dir, { recursive: true })
    run('tar', ['-xzf', tarball, '--strip-components=1', '-C', dir], consumer)
  }
  unpack('cli', archive)
  const manifest = (name) =>
    JSON.parse(readFileSync(resolve(installed, name, 'package.json'), 'utf8'))
  symlinkSync(
    resolve(cliRoot, 'node_modules/semver'),
    resolve(consumer, 'node_modules/semver'),
    'dir'
  )
  for (const [dialect, driver] of [
    ['postgres', 'pg'],
    ['mysql', 'mysql2'],
  ]) {
    const name = `db-${dialect}`
    const root = resolve(cliRoot, `../${name}`)
    const packs = resolve(destination, name)
    mkdirSync(packs)
    run(packageManagerCommand(), ['pack', '--pack-destination', packs], root)
    const archives = readdirSync(packs).filter((file) => file.endsWith('.tgz'))
    if (archives.length !== 1) fail(`expected one ${name} package`)
    unpack(name, resolve(packs, archives[0]))
    if (manifest('cli').dependencies[`@byline/${name}`] !== manifest(name).version)
      fail(`packed CLI must depend on the exact packed ${name}`)
    symlinkSync(
      resolve(root, 'node_modules', driver),
      resolve(consumer, 'node_modules', driver),
      'dir'
    )
    run(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `const p=await import('./dist/lib/database/${dialect}.js');await p.${dialect}Provisioner.verifyBaselineAssets()`,
      ],
      resolve(installed, 'cli')
    )
  }
  console.log(
    'CLI package resolves both exact packed adapters and verifies their frozen baselines.'
  )
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
