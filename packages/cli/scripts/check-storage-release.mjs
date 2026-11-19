import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { parse, stringify } from 'yaml'

const cli = fileURLToPath(new URL('..', import.meta.url))
const packages = dirname(cli)
const temp = realpathSync(mkdtempSync(join(tmpdir(), 'byline-packed-storage-')))
const consumer = join(temp, 'consumer')
const read = (path) => JSON.parse(readFileSync(path, 'utf8'))
const roots = [
  'cli',
  'client',
  'auth',
  'core',
  'db-postgres',
  'db-mysql',
  'search-postgres',
  'search-mysql',
  'analytics-postgres',
  'analytics-mysql',
]
const archives = new Map()
function pack(name) {
  if (archives.has(name)) return
  const dir = join(packages, name.slice('@byline/'.length))
  const pkg = read(join(dir, 'package.json'))
  assert.equal(pkg.name, name)
  const destination = join(temp, pkg.name.split('/')[1])
  mkdirSync(destination)
  execFileSync('pnpm', ['pack', '--pack-destination', destination], { cwd: dir, stdio: 'pipe' })
  const files = readdirSync(destination)
  assert.equal(files.length, 1)
  archives.set(name, join(destination, files[0]))
  for (const dep of Object.keys({
    ...pkg.dependencies,
    ...pkg.peerDependencies,
    ...pkg.optionalDependencies,
  }))
    if (dep.startsWith('@byline/')) pack(dep)
}
try {
  mkdirSync(consumer)
  for (const name of roots) pack(`@byline/${name}`)
  const dependencies = Object.fromEntries(
    Array.from(archives, ([name, file]) => [name, `file:${file}`])
  )
  writeFileSync(
    join(consumer, 'package.json'),
    JSON.stringify({ name: 'storage-release-consumer', private: true, dependencies })
  )
  writeFileSync(
    join(consumer, 'pnpm-workspace.yaml'),
    stringify({ overrides: dependencies, minimumReleaseAge: 0, autoInstallPeers: true })
  )
  writeFileSync(join(consumer, '.npmrc'), '@byline:registry=http://127.0.0.1:1/\n')
  execFileSync(
    'pnpm',
    ['install', '--prefer-offline', '--ignore-scripts', '--no-frozen-lockfile'],
    { cwd: consumer, stdio: 'inherit' }
  )
  const lock = parse(readFileSync(join(consumer, 'pnpm-lock.yaml'), 'utf8'))
  for (const [name, archive] of archives) {
    const installed = realpathSync(join(consumer, 'node_modules', name))
    assert.ok(!relative(consumer, installed).startsWith('..'))
    const entries = Object.entries(lock.packages).filter(([key]) => key.startsWith(`${name}@`))
    assert.equal(entries.length, 1)
    const { resolution } = entries[0][1]
    assert.equal(resolve(consumer, resolution.tarball.replace(/^file:/, '')), archive)
    assert.equal(
      resolution.integrity,
      `sha512-${createHash('sha512').update(readFileSync(archive)).digest('base64')}`
    )
  }
  console.log('Verified locally packed release closure:', [...archives.keys()].join(', '))
  execFileSync(
    'pnpm',
    [
      'exec',
      'vitest',
      'run',
      '--mode=packed',
      '--disableConsoleIntercept',
      'tests/release/packed-storage.test.ts',
    ],
    { cwd: cli, stdio: 'inherit', env: { ...process.env, BYLINE_TEST_PACKED_ROOT: consumer } }
  )
} finally {
  rmSync(temp, { recursive: true, force: true })
}
