import { spawnSync } from 'node:child_process'
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const cliRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const packagesRoot = resolve(cliRoot, '..')
const templatesRoot = resolve(cliRoot, 'src/templates')
const dialectsRoot = resolve(templatesRoot, 'dialects')
const fixtureParent = mkdtempSync(resolve(tmpdir(), 'byline-cli-template-check-'))

try {
  const serverConfigs = walk(dialectsRoot)
    .filter((path) => path.endsWith('/server.config.ts'))
    .sort()
  if (serverConfigs.length === 0) {
    fail('no dialect server.config.ts templates found')
  }

  for (const source of serverConfigs) {
    const [adapter, layer, filename] = relative(dialectsRoot, source).split('/')
    if (!adapter || !layer || filename !== 'server.config.ts') {
      fail(`unexpected dialect template path: ${relative(dialectsRoot, source)}`)
    }

    const fixture = resolve(fixtureParent, `${adapter}-${layer}`)
    const byline = resolve(fixture, 'byline')
    copyLayer(resolve(templatesRoot, 'byline'), byline)
    copyLayer(resolve(dialectsRoot, adapter, 'byline'), byline)
    if (layer === 'byline-examples') {
      copyLayer(resolve(templatesRoot, 'byline-examples'), byline)
      copyLayer(resolve(dialectsRoot, adapter, 'byline-examples'), byline)
    }

    linkWorkspacePackages(fixture)
    writeFileSync(
      resolve(fixture, 'tsconfig.json'),
      `${JSON.stringify(
        {
          compilerOptions: {
            target: 'ES2024',
            lib: ['ES2024', 'DOM'],
            module: 'ESNext',
            moduleResolution: 'Bundler',
            allowImportingTsExtensions: true,
            isolatedModules: true,
            noEmit: true,
            strict: true,
            skipLibCheck: true,
            jsx: 'react-jsx',
            types: ['node'],
            paths: { '~/*': ['./byline/*'] },
          },
          include: ['byline/server.config.ts', 'byline/generated/collection-types.ts'],
        },
        null,
        2
      )}\n`
    )

    const result = spawnSync(
      tscCommand(),
      ['--project', resolve(fixture, 'tsconfig.json'), '--pretty', 'false'],
      {
        cwd: fixture,
        encoding: 'utf8',
        maxBuffer: 20 * 1024 * 1024,
      }
    )
    if (result.status !== 0) {
      fail(
        `${adapter}/${layer}/server.config.ts failed tsc --noEmit:\n${
          result.stdout || result.stderr
        }`
      )
    }
    console.log(`template typecheck passed: ${adapter}/${layer}/server.config.ts`)
  }
} finally {
  rmSync(fixtureParent, { recursive: true, force: true })
}

function copyLayer(source, target) {
  if (!existsSync(source)) return
  mkdirSync(target, { recursive: true })
  cpSync(source, target, { recursive: true, force: true })
}

function linkWorkspacePackages(fixture) {
  const scopeRoot = resolve(fixture, 'node_modules/@byline')
  mkdirSync(scopeRoot, { recursive: true })
  for (const directory of readdirSync(packagesRoot)) {
    const packageRoot = resolve(packagesRoot, directory)
    const manifestPath = resolve(packageRoot, 'package.json')
    if (!existsSync(manifestPath)) continue
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    if (typeof manifest.name !== 'string' || !manifest.name.startsWith('@byline/')) continue
    symlinkSync(packageRoot, resolve(scopeRoot, manifest.name.slice('@byline/'.length)), 'dir')
  }

  const typesRoot = resolve(fixture, 'node_modules/@types')
  mkdirSync(typesRoot, { recursive: true })
  symlinkSync(resolve(cliRoot, 'node_modules/@types/node'), resolve(typesRoot, 'node'), 'dir')
}

function tscCommand() {
  return resolve(cliRoot, `node_modules/.bin/${process.platform === 'win32' ? 'tsc.cmd' : 'tsc'}`)
}

function walk(root) {
  const files = []
  for (const name of readdirSync(root, { withFileTypes: true })) {
    const path = resolve(root, name.name)
    if (name.isDirectory()) files.push(...walk(path))
    else files.push(path)
  }
  return files
}

function fail(message) {
  throw new Error(message)
}
