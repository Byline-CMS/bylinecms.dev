import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { CLI_PACKAGE_VERSION } from './lib/release-policy.js'
import {
  resolveWorkspaceOwnership,
  validateWorkspacePackageManager,
  workspaceManagerConstraint,
} from './lib/workspace-root.js'
import { DEP_SPECS } from './manifest/deps.js'
import { depsPhase } from './phases/deps.js'
import { detectPackageManager, preflightPhase } from './phases/preflight.js'
import { buildScaffoldPlan } from './phases/scaffold.js'
import { createTestContextAt } from './test-helpers.js'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('workspace root ownership', () => {
  it('plans root settings and targets a nested pnpm app without creating nested workspace files', async () => {
    const root = monorepo('pnpm')
    const app = join(root, 'apps/webapp')
    const dependencies = compatibleDependencies()
    delete dependencies.classnames
    writeFileSync(
      join(app, 'package.json'),
      `${JSON.stringify({ name: '@fixture/webapp', dependencies, scripts: {} }, null, 2)}\n`
    )
    writeFileSync(join(root, 'pnpm-workspace.yaml'), 'packages:\n  - apps/*\n')
    writeFileSync(join(root, 'turbo.json'), '{"tasks":{}}\n')
    mkdirSync(join(root, '.github/workflows'), { recursive: true })
    writeFileSync(join(root, '.github/workflows/ci.yml'), 'steps:\n  - run: pnpm typecheck\n')

    const ctx = createTestContextAt(app, { examples: false })
    ctx.pm = 'pnpm'
    expect(ctx.workspaceRoot).toBe(root)

    const deps = await depsPhase.plan(ctx)
    expect(deps.writes.some((write) => write.path === join(root, 'pnpm-workspace.yaml'))).toBe(true)
    expect(deps.writes.some((write) => write.path === join(app, 'pnpm-workspace.yaml'))).toBe(false)
    expect(deps.commands[0]).toMatchObject({
      cwd: root,
      command: 'pnpm',
      args: ['--filter', './apps/webapp', 'add', 'classnames@^2.5.1'],
    })

    const scaffold = buildScaffoldPlan(ctx)
    expect(scaffold.writes.some((write) => write.path === join(root, 'turbo.json'))).toBe(true)
    expect(scaffold.writes.some((write) => write.path === join(app, 'package.json'))).toBe(true)
    expect(scaffold.notes.join('\n')).toContain(join(root, '.github/workflows/ci.yml'))
  })

  it('uses pnpm workspace-root mode when the app owns the root', async () => {
    const root = mkdtempSync(join(tmpdir(), 'byline-pnpm-root-'))
    roots.push(root)
    const dependencies = compatibleDependencies()
    delete dependencies.classnames
    writeFileSync(
      join(root, 'package.json'),
      `${JSON.stringify({ name: '@fixture/root-app', dependencies })}\n`
    )
    const ctx = createTestContextAt(root, { examples: false })
    ctx.pm = 'pnpm'
    const command = (await depsPhase.plan(ctx)).commands[0]
    expect(command).toEqual({
      command: 'pnpm',
      args: ['add', '-w', 'classnames@^2.5.1'],
      cwd: root,
    })
  })

  it.each([
    ['yarn', 'yarn.lock'],
    ['npm', 'package-lock.json'],
    ['bun', 'bun.lock'],
  ] as const)('detects %s from a workspace ancestor', (manager, lockfile) => {
    const root = monorepo(manager)
    writeFileSync(join(root, lockfile), '')
    expect(detectPackageManager(join(root, 'apps/webapp'))).toBe(manager)
  })

  it.each(['yarn', 'npm', 'bun'] as const)(
    'synchronizes a completed setup/doctor preflight from persisted %s state',
    async (manager) => {
      const root = mkdtempSync(join(tmpdir(), 'byline-persisted-manager-'))
      roots.push(root)
      writeFileSync(join(root, 'package.json'), '{"name":"standalone"}\n')
      const ctx = createTestContextAt(root)
      ctx.state.patchAnswers({ pm: manager })
      ctx.state.markPhaseComplete('preflight')
      ctx.pm = 'pnpm'
      expect(await preflightPhase.detect(ctx)).toBe('done')
      expect(ctx.pm).toBe(manager)
    }
  )

  it.each(['root', 'nested'] as const)(
    'blocks noninteractive manager defaulting in a package.json-only %s workspace',
    async (location) => {
      const root = packageJsonOnlyWorkspace()
      const cwd = location === 'root' ? root : join(root, 'apps/webapp')
      mkdirSync(join(cwd, '.git'), { recursive: true })
      const ctx = createTestContextAt(cwd)
      expect((await preflightPhase.apply(await preflightPhase.plan(ctx), ctx)).state).toBe(
        'blocked'
      )
    }
  )

  it.each(['root', 'nested'] as const)(
    'creates complete pnpm metadata for an explicit package.json-only %s workspace',
    async (location) => {
      const root = packageJsonOnlyWorkspace()
      const cwd = location === 'root' ? root : join(root, 'apps/webapp')
      mkdirSync(join(cwd, '.git'), { recursive: true })
      const packagePath = join(cwd, 'package.json')
      const existing = JSON.parse(readFileSync(packagePath, 'utf8')) as Record<string, unknown>
      writeFileSync(
        packagePath,
        `${JSON.stringify({ ...existing, dependencies: compatibleDependencies() })}\n`
      )
      const ctx = createTestContextAt(cwd, { examples: false })
      ctx.cliFlags.pm = 'pnpm'
      expect((await preflightPhase.apply(await preflightPhase.plan(ctx), ctx)).state).toBe('done')
      const deps = await depsPhase.plan(ctx)
      const workspaceWrite = deps.writes.find(
        (write) => write.path === join(root, 'pnpm-workspace.yaml')
      )
      expect(workspaceWrite?.contents).toContain('packages:')
      expect(workspaceWrite?.contents).toContain('apps/*')
      expect(workspaceWrite?.contents).toContain('allowBuilds:')
      expect((await depsPhase.apply(deps, ctx)).state).toBe('done')
      expect(resolveWorkspaceOwnership(cwd)).toMatchObject({ root, kind: 'pnpm' })
    }
  )

  it.each(['npm', 'yarn', 'bun'] as const)(
    'uses explicit %s in a package.json-only workspace without creating pnpm metadata',
    async (manager) => {
      const root = packageJsonOnlyWorkspace()
      const app = join(root, 'apps/webapp')
      const dependencies = compatibleDependencies()
      delete dependencies.classnames
      writeFileSync(
        join(app, 'package.json'),
        `${JSON.stringify({ name: '@fixture/webapp', dependencies })}\n`
      )
      mkdirSync(join(app, '.git'))
      const ctx = createTestContextAt(app, { examples: false })
      ctx.cliFlags.pm = manager
      expect((await preflightPhase.apply(await preflightPhase.plan(ctx), ctx)).state).toBe('done')
      const deps = await depsPhase.plan(ctx)
      expect(deps.writes.some((write) => write.path.endsWith('pnpm-workspace.yaml'))).toBe(false)
      expect(deps.commands[0]?.command).toBe(manager)
    }
  )

  it.each(['yarn', 'npm', 'bun'] as const)(
    'targets a nested app safely with %s',
    async (manager) => {
      const root = monorepo(manager)
      const app = join(root, 'apps/webapp')
      const dependencies = compatibleDependencies()
      delete dependencies.classnames
      writeFileSync(
        join(app, 'package.json'),
        `${JSON.stringify({ name: '@fixture/webapp', dependencies })}\n`
      )
      const ctx = createTestContextAt(app, { examples: false })
      ctx.pm = manager
      const command = (await depsPhase.plan(ctx)).commands[0]
      expect(command?.command).toBe(manager)
      if (manager === 'yarn') {
        expect(command).toMatchObject({ cwd: root })
        expect(command?.args.slice(0, 3)).toEqual(['workspace', '@fixture/webapp', 'add'])
      } else if (manager === 'npm') {
        expect(command).toMatchObject({ cwd: root })
        expect(command?.args).toEqual(
          expect.arrayContaining(['--workspace', './apps/webapp', 'classnames@^2.5.1'])
        )
      } else {
        expect(command).toMatchObject({ cwd: app })
        expect(command?.args).toContain('classnames@^2.5.1')
      }
    }
  )

  it('resolves a bare workspace link from local workspace package metadata', async () => {
    const root = monorepo('pnpm')
    const app = join(root, 'apps/webapp')
    mkdirSync(join(root, 'packages/core'), { recursive: true })
    writeFileSync(
      join(root, 'pnpm-workspace.yaml'),
      'packages:\n  - apps/*\n  - packages/*\nallowBuilds:\n  "@google/genai": true\n  esbuild: true\n  protobufjs: true\n  sharp: true\n'
    )
    // The workspace-linked package's version must satisfy the CLI's derived
    // release policy (`>=<cli version> <next major>`), which Changesets bumps
    // every release — track it rather than pinning a literal that goes stale.
    writeFileSync(
      join(root, 'packages/core/package.json'),
      `{"name":"@byline/core","version":"${CLI_PACKAGE_VERSION}"}\n`
    )
    const dependencies = compatibleDependencies()
    dependencies['@byline/core'] = 'workspace:*'
    writeFileSync(join(app, 'package.json'), `${JSON.stringify({ dependencies })}\n`)
    const ctx = createTestContextAt(app, { examples: false })
    ctx.pm = 'pnpm'
    expect(await depsPhase.detect(ctx)).toBe('done')
  })

  it('keeps an excluded nested standalone app isolated from an outer pnpm workspace', async () => {
    const root = monorepo('pnpm')
    writeFileSync(
      join(root, 'pnpm-workspace.yaml'),
      'packages:\n  - apps/*\n  - "!apps/excluded"\n'
    )
    writeFileSync(join(root, 'turbo.json'), '{"tasks":{}}\n')
    mkdirSync(join(root, '.github/workflows'), { recursive: true })
    writeFileSync(join(root, '.github/workflows/ci.yml'), 'steps:\n  - run: pnpm typecheck\n')
    const standalone = join(root, 'apps/excluded')
    mkdirSync(standalone, { recursive: true })
    const standaloneDependencies = compatibleDependencies()
    delete standaloneDependencies.classnames
    writeFileSync(
      join(standalone, 'package.json'),
      `${JSON.stringify({ packageManager: 'npm@11', dependencies: standaloneDependencies })}\n`
    )

    const ctx = createTestContextAt(standalone, { examples: false })
    expect(ctx.workspaceRoot).toBe(standalone)
    expect(detectPackageManager(standalone)).toBe('npm')
    const scaffold = buildScaffoldPlan(ctx)
    expect(scaffold.writes.some((write) => write.path === join(root, 'turbo.json'))).toBe(false)
    expect(scaffold.notes.join('\n')).not.toContain(join(root, '.github/workflows/ci.yml'))

    ctx.pm = 'pnpm'
    const deps = await depsPhase.plan(ctx)
    expect(deps.writes.some((write) => write.path === join(root, 'pnpm-workspace.yaml'))).toBe(
      false
    )
    expect(
      deps.writes.some((write) => write.path === join(standalone, 'pnpm-workspace.yaml'))
    ).toBe(true)
    expect(deps.commands[0]).toMatchObject({ cwd: standalone, command: 'pnpm' })
    expect(deps.commands[0]?.args).not.toContain('--filter')
    expect(existsSync(join(standalone, 'pnpm-workspace.yaml'))).toBe(false)
  })

  it.each([
    ['pnpm', 'npm'],
    ['npm', 'pnpm'],
    ['yarn', 'npm'],
    ['bun', 'yarn'],
  ] as const)('blocks %s workspace use with explicit %s', async (workspaceManager, selected) => {
    const root = monorepo(workspaceManager)
    const app = join(root, 'apps/webapp')
    if (workspaceManager === 'pnpm') {
      writeFileSync(join(root, 'pnpm-workspace.yaml'), 'packages:\n  - apps/*\n')
    }
    writeFileSync(join(app, 'package.json'), '{"name":"@fixture/webapp"}\n')
    mkdirSync(join(app, '.git'))
    const ctx = createTestContextAt(app)
    ctx.cliFlags.pm = selected
    const validation = validateWorkspacePackageManager(app, selected)
    expect(validation).toEqual({
      valid: false,
      expected: workspaceManager,
      reason: `owning workspace uses ${workspaceManager}; use --pm ${workspaceManager}`,
    })
    expect((await preflightPhase.apply(await preflightPhase.plan(ctx), ctx)).state).toBe('blocked')
  })

  it('uses the authoritative workspace manager instead of prompting for another', async () => {
    const root = monorepo('yarn')
    const app = join(root, 'apps/webapp')
    writeFileSync(join(app, 'package.json'), '{"name":"@fixture/webapp"}\n')
    mkdirSync(join(app, '.git'))
    const ctx = createTestContextAt(app)
    ctx.pm = 'pnpm'
    expect((await preflightPhase.apply(await preflightPhase.plan(ctx), ctx)).state).toBe('done')
    expect(ctx.pm).toBe('yarn')
  })

  it('blocks a previously prompted manager that conflicts with the workspace', async () => {
    const root = monorepo('bun')
    const app = join(root, 'apps/webapp')
    writeFileSync(join(app, 'package.json'), '{"name":"@fixture/webapp"}\n')
    mkdirSync(join(app, '.git'))
    const ctx = createTestContextAt(app)
    ctx.state.patchAnswers({ pm: 'npm' })
    expect((await preflightPhase.apply(await preflightPhase.plan(ctx), ctx)).state).toBe('blocked')
  })

  it('allows an explicit manager for a standalone app without authoritative metadata', async () => {
    const root = mkdtempSync(join(tmpdir(), 'byline-standalone-manager-'))
    roots.push(root)
    writeFileSync(join(root, 'package.json'), '{"name":"standalone"}\n')
    mkdirSync(join(root, '.git'))
    const ctx = createTestContextAt(root)
    ctx.cliFlags.pm = 'bun'
    expect((await preflightPhase.apply(await preflightPhase.plan(ctx), ctx)).state).toBe('done')
    expect(ctx.pm).toBe('bun')
  })

  it('blocks ambiguous manager metadata consistently for root and nested apps', async () => {
    const root = monorepo('npm')
    const app = join(root, 'apps/webapp')
    writeFileSync(join(root, 'yarn.lock'), '')
    const rootConstraint = workspaceManagerConstraint(root)
    const nestedConstraint = workspaceManagerConstraint(app)
    expect(rootConstraint).toMatchObject({ authoritative: true, ambiguous: true })
    expect(nestedConstraint).toEqual(rootConstraint)
    expect(() => detectPackageManager(app)).toThrow('workspace package manager metadata conflicts')
  })

  it('blocks cross-manager dependency plans before creating workspace settings', async () => {
    const root = monorepo('npm')
    const app = join(root, 'apps/webapp')
    writeFileSync(
      join(app, 'package.json'),
      `${JSON.stringify({ dependencies: compatibleDependencies() })}\n`
    )
    const ctx = createTestContextAt(app, { examples: false })
    ctx.pm = 'pnpm'
    const plan = await depsPhase.plan(ctx)
    expect(plan.writes).toEqual([])
    expect(plan.commands).toEqual([])
    expect(plan.notes.join('\n')).toContain('owning workspace uses npm; use --pm npm')
    expect((await depsPhase.apply(plan, ctx)).state).toBe('blocked')
    expect(existsSync(join(root, 'pnpm-workspace.yaml'))).toBe(false)
  })

  it.each(['npm', 'yarn'] as const)(
    'does not emit %s workspace commands inside a pnpm workspace',
    async (manager) => {
      const root = monorepo('pnpm')
      const app = join(root, 'apps/webapp')
      writeFileSync(join(root, 'pnpm-workspace.yaml'), 'packages:\n  - apps/*\n')
      const dependencies = compatibleDependencies()
      delete dependencies.classnames
      writeFileSync(join(app, 'package.json'), `${JSON.stringify({ dependencies })}\n`)
      const ctx = createTestContextAt(app, { examples: false })
      ctx.pm = manager
      const plan = await depsPhase.plan(ctx)
      expect(plan.commands).toEqual([])
      expect(plan.writes).toEqual([])
      expect((await depsPhase.apply(plan, ctx)).state).toBe('blocked')
    }
  )
})

function monorepo(packageManager: string): string {
  const root = mkdtempSync(join(tmpdir(), 'byline-monorepo-'))
  roots.push(root)
  mkdirSync(join(root, 'apps/webapp'), { recursive: true })
  writeFileSync(
    join(root, 'package.json'),
    `${JSON.stringify({ private: true, packageManager: `${packageManager}@1.0.0`, workspaces: ['apps/*'] })}\n`
  )
  return root
}

function packageJsonOnlyWorkspace(): string {
  const root = mkdtempSync(join(tmpdir(), 'byline-package-workspace-'))
  roots.push(root)
  mkdirSync(join(root, 'apps/webapp'), { recursive: true })
  writeFileSync(
    join(root, 'package.json'),
    '{"private":true,"workspaces":["apps/*"],"name":"root"}\n'
  )
  writeFileSync(join(root, 'apps/webapp/package.json'), '{"name":"@fixture/webapp"}\n')
  return root
}

function compatibleDependencies(): Record<string, string> {
  return Object.fromEntries(
    DEP_SPECS.filter((spec) => !spec.optional).map((spec) => [spec.name, spec.version])
  )
}
