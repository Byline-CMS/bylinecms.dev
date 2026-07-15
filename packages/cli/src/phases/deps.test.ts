import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { shouldHaltInit } from '../commands/init.js'
import { findBylineDependencyIssues, findMissingBylineDeps } from '../commands/setup-checks.js'
import { isDependencyVersionCompatible } from '../lib/dependency-version.js'
import { DEP_SPECS } from '../manifest/deps.js'
import { createTestContext, createTestContextAt } from '../test-helpers.js'
import { depsPhase, validateDependencyPlan, validateDependencyPostconditions } from './deps.js'
import type { Context } from '../context.js'

const contexts: Context[] = []
const roots: string[] = []
afterEach(() => {
  for (const ctx of contexts.splice(0)) rmSync(ctx.cwd, { recursive: true, force: true })
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('Byline dependency compatibility', () => {
  const core = DEP_SPECS.find((spec) => spec.name === '@byline/core')!

  it.each([
    ['^3.21', true],
    ['~3.22.0', true],
    ['3.21.0', true],
    ['3.99.4', true],
    ['>=3.21.0 <4', true],
    ['workspace:*', false],
    ['workspace:^', false],
    ['workspace:~', false],
    ['workspace:^3.21.0', true],
    ['workspace:~3.22.0', true],
    ['workspace:3.23.1', true],
    ['workspace:^3.20.0', false],
    ['^3.20.0', false],
    ['>=3.21.0', false],
    ['^4.0.0', false],
    ['^3.21.0 || ^4.0.0', false],
    ['npm:@byline/core@^3.21.0', true],
    ['npm:@byline/core@^4.0.0', false],
    ['npm:@byline/admin@^3.21.0', false],
    ['latest', false],
  ])('classifies %s as compatible=%s', (range, compatible) => {
    expect(isDependencyVersionCompatible(core, range)).toBe(compatible)
  })

  it.each([
    'workspace:*',
    'workspace:^',
    'workspace:~',
  ])('never replaces the local workspace shorthand %s', async (workspaceRange) => {
    const ctx = createTestContext({ examples: false })
    contexts.push(ctx)
    const dependencies = compatibleDependencies()
    dependencies['@byline/core'] = workspaceRange
    writeFileSync(ctx.resolve('package.json'), `${JSON.stringify({ dependencies }, null, 2)}\n`)
    writeFileSync(ctx.resolve('pnpm-workspace.yaml'), completeWorkspaceYaml())
    const plan = await depsPhase.plan(ctx)
    expect(plan.commands.flatMap((command) => command.args).join(' ')).not.toContain(
      '@byline/core@'
    )
  })

  it('plans upgrades for incompatible declarations and leaves compatible ranges untouched', async () => {
    const ctx = createTestContext({ examples: false })
    contexts.push(ctx)
    const dependencies = compatibleDependencies()
    dependencies['@byline/core'] = '^3.20.0'
    dependencies['@byline/admin'] = '^3.22.0'
    dependencies['@byline/ai'] = 'workspace:^3.21.0'
    dependencies['@byline/ui'] = '^4.0.0'
    writeFileSync(ctx.resolve('package.json'), `${JSON.stringify({ dependencies }, null, 2)}\n`)

    const plan = await depsPhase.plan(ctx)
    const command = plan.commands.flatMap((item) => item.args).join(' ')
    expect(command).toContain('@byline/core@^3.21.0')
    expect(command).not.toContain('@byline/admin@')
    expect(command).not.toContain('@byline/ai@')
    expect(command).toContain('@byline/ui@^3.21.0')
    ctx.state.markPhaseComplete('deps')
    expect(await depsPhase.detect(ctx)).toBe('pending')
    expect(findMissingBylineDeps(ctx)?.map((spec) => spec.name)).toContain('@byline/core')
    expect(findMissingBylineDeps(ctx)?.map((spec) => spec.name)).not.toContain('@byline/admin')
    expect(findMissingBylineDeps(ctx)?.map((spec) => spec.name)).not.toContain('@byline/ai')
    expect(findMissingBylineDeps(ctx)?.map((spec) => spec.name)).toContain('@byline/ui')
  })

  it.each([
    ['3.20.9', 'incompatible'],
    ['3.21.0', 'compatible'],
    ['3.99.0', 'compatible'],
    ['4.0.0', 'incompatible'],
  ] as const)('checks bare workspace links against resolved version %s', async (actual, status) => {
    const ctx = linkedWorkspaceContext(actual)
    const dependencies = compatibleDependencies()
    dependencies['@byline/core'] = 'workspace:*'
    writeFileSync(ctx.resolve('package.json'), `${JSON.stringify({ dependencies }, null, 2)}\n`)

    const plan = await depsPhase.plan(ctx)
    const coreCommand = plan.commands.flatMap((command) => command.args).join(' ')
    expect(coreCommand).not.toContain('@byline/core@')
    expect(await depsPhase.detect(ctx)).toBe(status === 'compatible' ? 'done' : 'pending')
    expect(
      findBylineDependencyIssues(ctx)?.find((issue) => issue.spec.name === '@byline/core')
        ?.compatibility?.status
    ).toBe(status === 'compatible' ? undefined : status)
    const result = await depsPhase.apply(plan, ctx)
    expect(result.state).toBe(status === 'compatible' ? 'done' : 'blocked')
    expect(shouldHaltInit(result.state)).toBe(status !== 'compatible')
  })

  it('keeps an unresolved bare workspace link manual instead of replacing it', async () => {
    const ctx = linkedWorkspaceContext()
    const dependencies = compatibleDependencies()
    dependencies['@byline/core'] = 'workspace:^'
    writeFileSync(ctx.resolve('package.json'), `${JSON.stringify({ dependencies }, null, 2)}\n`)

    const plan = await depsPhase.plan(ctx)
    expect(plan.commands.flatMap((command) => command.args).join(' ')).not.toContain(
      '@byline/core@'
    )
    expect(plan.notes.join('\n')).toContain('could not be resolved locally')
    expect(await depsPhase.detect(ctx)).toBe('pending')
    expect(
      findBylineDependencyIssues(ctx)?.find((issue) => issue.spec.name === '@byline/core')
        ?.compatibility?.status
    ).toBe('unknown')
    expect((await depsPhase.apply(plan, ctx)).state).toBe('blocked')
  })

  it('uses included workspace metadata over stale node_modules and ignores excluded duplicates', async () => {
    const ctx = linkedWorkspaceContext('3.20.0')
    const root = ctx.workspaceRoot
    mkdirSync(join(root, 'packages/excluded-core'), { recursive: true })
    writeFileSync(
      join(root, 'packages/excluded-core/package.json'),
      '{"name":"@byline/core","version":"4.0.0"}\n'
    )
    writeFileSync(
      join(root, 'pnpm-workspace.yaml'),
      'packages:\n  - apps/*\n  - packages/*\n  - "!packages/excluded-*"\n'
    )
    mkdirSync(ctx.resolve('node_modules/@byline/core'), { recursive: true })
    writeFileSync(
      ctx.resolve('node_modules/@byline/core/package.json'),
      '{"name":"@byline/core","version":"3.21.9"}\n'
    )
    const dependencies = compatibleDependencies()
    dependencies['@byline/core'] = 'workspace:*'
    writeFileSync(ctx.resolve('package.json'), `${JSON.stringify({ dependencies })}\n`)
    expect(await depsPhase.detect(ctx)).toBe('pending')
    const plan = await depsPhase.plan(ctx)
    expect(plan.notes.join('\n')).toContain('resolves to unsupported 3.20.0')
    expect((await depsPhase.apply(plan, ctx)).state).toBe('blocked')
  })

  it('does not resolve a package that exists only in an excluded workspace', async () => {
    const ctx = linkedWorkspaceContext()
    mkdirSync(join(ctx.workspaceRoot, 'packages/excluded-core'), { recursive: true })
    writeFileSync(
      join(ctx.workspaceRoot, 'packages/excluded-core/package.json'),
      '{"name":"@byline/core","version":"3.21.9"}\n'
    )
    writeFileSync(
      join(ctx.workspaceRoot, 'pnpm-workspace.yaml'),
      'packages:\n  - apps/*\n  - packages/*\n  - "!packages/excluded-*"\n'
    )
    const dependencies = compatibleDependencies()
    dependencies['@byline/core'] = 'workspace:*'
    writeFileSync(ctx.resolve('package.json'), `${JSON.stringify({ dependencies })}\n`)
    const plan = await depsPhase.plan(ctx)
    expect(plan.notes.join('\n')).toContain('could not be resolved locally')
    expect((await depsPhase.apply(plan, ctx)).state).toBe('blocked')
  })

  it('treats duplicate included workspace package names as unknown', async () => {
    const ctx = linkedWorkspaceContext('3.21.2')
    mkdirSync(join(ctx.workspaceRoot, 'packages/core-copy'), { recursive: true })
    writeFileSync(
      join(ctx.workspaceRoot, 'packages/core-copy/package.json'),
      '{"name":"@byline/core","version":"3.22.0"}\n'
    )
    const dependencies = compatibleDependencies()
    dependencies['@byline/core'] = 'workspace:*'
    writeFileSync(ctx.resolve('package.json'), `${JSON.stringify({ dependencies })}\n`)
    const plan = await depsPhase.plan(ctx)
    expect(plan.notes.join('\n')).toContain('could not be resolved locally')
    expect((await depsPhase.apply(plan, ctx)).state).toBe('blocked')
  })

  it('detects and applies settings-only allowBuilds changes from planned writes', async () => {
    const ctx = createTestContext({ examples: false })
    contexts.push(ctx)
    writeFileSync(
      ctx.resolve('package.json'),
      `${JSON.stringify({ dependencies: compatibleDependencies() }, null, 2)}\n`
    )
    writeFileSync(ctx.resolve('pnpm-workspace.yaml'), 'packages:\n  - .\n')

    expect(await depsPhase.detect(ctx)).toBe('pending')
    const plan = await depsPhase.plan(ctx)
    expect(plan.commands).toEqual([])
    expect(plan.writes.map((write) => write.path)).toContain(ctx.resolve('pnpm-workspace.yaml'))
    expect((await depsPhase.apply(plan, ctx)).state).toBe('done')
    expect(readFileSync(ctx.resolve('pnpm-workspace.yaml'), 'utf8')).toContain('allowBuilds:')
    expect(await depsPhase.detect(ctx)).toBe('done')
  })

  it('detects stale package settings and atomically rejects a stale plan', async () => {
    const ctx = createTestContext({ examples: false })
    contexts.push(ctx)
    const packagePath = ctx.resolve('package.json')
    writeFileSync(
      packagePath,
      `${JSON.stringify(
        {
          dependencies: compatibleDependencies(),
          pnpm: { onlyBuiltDependencies: ['sharp'] },
        },
        null,
        2
      )}\n`
    )
    writeFileSync(ctx.resolve('pnpm-workspace.yaml'), completeWorkspaceYaml())

    expect(await depsPhase.detect(ctx)).toBe('pending')
    const plan = await depsPhase.plan(ctx)
    expect(plan.writes).toHaveLength(1)
    const changed = `${readFileSync(packagePath, 'utf8').trimEnd()}\n `
    writeFileSync(packagePath, changed)
    expect((await depsPhase.apply(plan, ctx)).state).toBe('blocked')
    expect(readFileSync(packagePath, 'utf8')).toBe(changed)
  })

  it.each([
    [
      'workspace link',
      (deps: Record<string, string>): void => {
        deps['@byline/core'] = 'workspace:*'
      },
    ],
    [
      'compatible range',
      (deps: Record<string, string>): void => {
        deps['@byline/core'] = '^3.22.0'
      },
    ],
    [
      'removed dependency',
      (deps: Record<string, string>): void => {
        delete deps['@byline/core']
      },
    ],
    [
      'added dependency',
      (deps: Record<string, string>): void => {
        deps.classnames = '^2.5.1'
      },
    ],
  ] as const)('blocks stale install candidates after a %s change', async (_name, mutate) => {
    const ctx = createTestContext({ examples: false })
    contexts.push(ctx)
    ctx.pm = 'npm'
    const dependencies = compatibleDependencies()
    dependencies['@byline/core'] = '^3.20.0'
    delete dependencies.classnames
    const packagePath = ctx.resolve('package.json')
    writeFileSync(packagePath, `${JSON.stringify({ dependencies }, null, 2)}\n`)
    const plan = await depsPhase.plan(ctx)

    mutate(dependencies)
    const changed = `${JSON.stringify({ dependencies }, null, 2)}\n`
    writeFileSync(packagePath, changed)
    expect(validateDependencyPlan(plan, ctx)).toMatchObject({ valid: false })
    expect((await depsPhase.apply(plan, ctx)).state).toBe('blocked')
    expect(readFileSync(packagePath, 'utf8')).toBe(changed)
  })

  it('blocks package-manager changes before settings writes or install commands', async () => {
    const ctx = createTestContext({ examples: false })
    contexts.push(ctx)
    const dependencies = compatibleDependencies()
    dependencies['@byline/core'] = '^3.20.0'
    writeFileSync(ctx.resolve('package.json'), `${JSON.stringify({ dependencies })}\n`)
    const plan = await depsPhase.plan(ctx)
    expect(plan.writes.some((write) => write.path.endsWith('pnpm-workspace.yaml'))).toBe(true)

    ctx.pm = 'npm'
    expect((await depsPhase.apply(plan, ctx)).state).toBe('blocked')
    expect(existsSync(ctx.resolve('pnpm-workspace.yaml'))).toBe(false)
  })

  it('blocks workspace-target changes before root settings writes', async () => {
    const root = mkdtempSync(join(tmpdir(), 'byline-stale-target-'))
    roots.push(root)
    const app = join(root, 'apps/webapp')
    mkdirSync(app, { recursive: true })
    writeFileSync(join(root, 'package.json'), '{"private":true,"workspaces":["apps/*"]}\n')
    writeFileSync(join(root, 'pnpm-workspace.yaml'), 'packages:\n  - apps/*\n')
    const dependencies = compatibleDependencies()
    dependencies['@byline/core'] = '^3.20.0'
    writeFileSync(join(app, 'package.json'), `${JSON.stringify({ dependencies })}\n`)
    const ctx = createTestContextAt(app, { examples: false })
    contexts.push(ctx)
    ctx.pm = 'pnpm'
    const plan = await depsPhase.plan(ctx)

    const changedWorkspace = 'packages:\n  - other/*\n'
    writeFileSync(join(root, 'pnpm-workspace.yaml'), changedWorkspace)
    expect((await depsPhase.apply(plan, ctx)).state).toBe('blocked')
    expect(readFileSync(join(root, 'pnpm-workspace.yaml'), 'utf8')).toBe(changedWorkspace)
    expect(existsSync(join(app, 'pnpm-workspace.yaml'))).toBe(false)
  })

  it.each(['false', 'null', '"yes"'])('repairs non-true allowBuilds values (%s)', async (value) => {
    const ctx = createTestContext({ examples: false })
    contexts.push(ctx)
    writeFileSync(
      ctx.resolve('package.json'),
      `${JSON.stringify({ dependencies: compatibleDependencies() }, null, 2)}\n`
    )
    writeFileSync(
      ctx.resolve('pnpm-workspace.yaml'),
      [
        'allowBuilds:',
        `  "@google/genai": ${value}`,
        '  esbuild: true',
        '  protobufjs: true',
        '  sharp: true',
        '',
      ].join('\n')
    )
    expect(await depsPhase.detect(ctx)).toBe('pending')
    const plan = await depsPhase.plan(ctx)
    expect(
      plan.writes.find((write) => write.path.endsWith('pnpm-workspace.yaml'))?.contents
    ).toContain('"@google/genai": true')
    expect((await depsPhase.apply(plan, ctx)).state).toBe('done')
    expect(await depsPhase.detect(ctx)).toBe('done')
  })

  it('blocks missing postconditions and manual invalid settings', async () => {
    const missing = createTestContext({ examples: false })
    contexts.push(missing)
    missing.pm = 'npm'
    writeFileSync(missing.resolve('package.json'), '{"dependencies":{}}\n')
    expect(validateDependencyPostconditions(missing)).toMatchObject({ valid: false })

    const incomplete = createTestContext({ examples: false })
    contexts.push(incomplete)
    writeFileSync(
      incomplete.resolve('package.json'),
      `${JSON.stringify({ dependencies: compatibleDependencies() })}\n`
    )
    writeFileSync(incomplete.resolve('pnpm-workspace.yaml'), 'allowBuilds: false\n')
    expect(validateDependencyPostconditions(incomplete)).toEqual({
      valid: false,
      reason: 'required dependency settings remain incomplete',
    })
    const plan = await depsPhase.plan(incomplete)
    expect((await depsPhase.apply(plan, incomplete)).state).toBe('blocked')
  })

  it('includes mdast-util-to-string only for import-docs installs', async () => {
    const without = createTestContext({ importDocs: false })
    contexts.push(without)
    writeFileSync(without.resolve('package.json'), '{"dependencies":{}}\n')
    expect(JSON.stringify(await depsPhase.plan(without))).not.toContain('mdast-util-to-string')

    const withDocs = createTestContext({ importDocs: true })
    contexts.push(withDocs)
    writeFileSync(withDocs.resolve('package.json'), '{"dependencies":{}}\n')
    expect(JSON.stringify(await depsPhase.plan(withDocs))).toContain('mdast-util-to-string')
  })
})

function compatibleDependencies(): Record<string, string> {
  return Object.fromEntries(
    DEP_SPECS.filter((spec) => !spec.optional).map((spec) => [spec.name, spec.version])
  )
}

function completeWorkspaceYaml(): string {
  return `allowBuilds:\n${['@google/genai', 'esbuild', 'protobufjs', 'sharp']
    .map((name) => `  ${JSON.stringify(name)}: true`)
    .join('\n')}\n`
}

function linkedWorkspaceContext(version?: string): Context {
  const root = mkdtempSync(join(tmpdir(), 'byline-linked-workspace-'))
  roots.push(root)
  const app = join(root, 'apps/webapp')
  mkdirSync(app, { recursive: true })
  writeFileSync(
    join(root, 'package.json'),
    '{"private":true,"workspaces":["apps/*","packages/*"]}\n'
  )
  writeFileSync(
    join(root, 'pnpm-workspace.yaml'),
    `packages:\n  - apps/*\n  - packages/*\n${completeWorkspaceYaml()}`
  )
  if (version) {
    mkdirSync(join(root, 'packages/core'), { recursive: true })
    writeFileSync(
      join(root, 'packages/core/package.json'),
      `${JSON.stringify({ name: '@byline/core', version })}\n`
    )
  }
  const ctx = createTestContextAt(app, { examples: false })
  contexts.push(ctx)
  ctx.pm = 'pnpm'
  return ctx
}
