import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'

import { afterEach, describe, expect, it } from 'vitest'

import { createTestContext } from '../test-helpers.js'
import { buildRoutesPlan, routesPhase } from './routes.js'
import { buildScaffoldPlan, scaffoldPhase, shouldIncludeExampleTemplate } from './scaffold.js'
import type { Context } from '../context.js'

const contexts: Context[] = []

afterEach(() => {
  for (const ctx of contexts.splice(0)) rmSync(ctx.cwd, { recursive: true, force: true })
})

function fixture(answers: Parameters<typeof createTestContext>[0] = {}): Context {
  const ctx = createTestContext(answers)
  contexts.push(ctx)
  writeFileSync(
    ctx.resolve('package.json'),
    `${JSON.stringify({ name: 'fixture', scripts: { test: 'vitest' } }, null, 2)}\n`
  )
  return ctx
}

describe('scaffold planning', () => {
  it('normalizes backslash paths before inventory filtering', () => {
    expect(shouldIncludeExampleTemplate('scripts\\import-docs.ts', false)).toBe(false)
    expect(shouldIncludeExampleTemplate('scripts\\lib\\helper.ts', false)).toBe(false)
    expect(shouldIncludeExampleTemplate('scripts\\lib\\helper.ts', true)).toBe(true)
    expect(shouldIncludeExampleTemplate('scripts\\lib\\helper.test.node.ts', true)).toBe(false)
  })

  it('plans concrete default-example writes and applies exactly their previewed contents', async () => {
    const ctx = fixture({ examples: true, importDocs: false, adminPath: '/admin' })
    const plan = buildScaffoldPlan(ctx)
    expect(plan.writes.some((write) => write.path.endsWith('byline/routes.ts'))).toBe(true)
    expect(plan.writes.some((write) => write.path.includes('import-docs'))).toBe(false)

    expect((await scaffoldPhase.apply(plan, ctx)).state).toBe('done')
    for (const write of plan.writes) expect(readFileSync(write.path, 'utf8')).toBe(write.contents)
  })

  it('creates custom runtime routes and never overwrites a divergent routes.ts', async () => {
    const ctx = fixture({ examples: false, adminPath: '/cms', signInPath: '/staff/login' })
    const initial = buildScaffoldPlan(ctx)
    const routesWrite = initial.writes.find((write) => write.path.endsWith('byline/routes.ts'))
    expect(routesWrite?.contents).toContain("admin: '/cms'")
    expect(routesWrite?.contents).toContain("signIn: '/staff/login'")
    await scaffoldPhase.apply(initial, ctx)

    writeFileSync(ctx.resolve('byline/routes.ts'), "export const routes = { admin: '/mine' }\n")
    const rerun = buildScaffoldPlan(ctx)
    expect(rerun.writes.some((write) => write.path.endsWith('byline/routes.ts'))).toBe(false)
    expect(rerun.notes.join('\n')).toContain('manual')
    expect((await scaffoldPhase.apply(rerun, ctx)).state).toBe('partial')
    expect(readFileSync(ctx.resolve('byline/routes.ts'), 'utf8')).toContain("'/mine'")
  })

  it('counts matching user-owned routes as aligned without claiming write ownership', async () => {
    const ctx = fixture({ examples: false, adminPath: '/cms', signInPath: '/staff/login' })
    const path = ctx.resolve('byline/routes.ts')
    const source = `
      const values = { admin: '/cms', signIn: '/staff/login' } as const
      export const routes = { api: '/rpc', ...values } satisfies Record<string, string>
      // user-owned
    `
    mkdirSync(ctx.resolve('byline'), { recursive: true })
    writeFileSync(path, source)

    const plan = buildScaffoldPlan(ctx)
    expect(plan.writes.some((write) => write.path === path)).toBe(false)
    expect(plan.notes.join('\n')).not.toContain('manual — existing routes.ts')
    expect((await scaffoldPhase.apply(plan, ctx)).state).toBe('done')
    expect(readFileSync(path, 'utf8')).toBe(source)
  })

  it('defers the literal previous-release config migration and completes it in routes', async () => {
    const ctx = fixture({
      examples: false,
      importDocs: false,
      adminPath: '/admin',
      signInPath: '/staff/login',
    })
    const configPath = ctx.resolve('byline/routes.ts')
    mkdirSync(ctx.resolve('byline'), { recursive: true })
    writeFileSync(configPath, previousReleaseRoutesSource())

    const scaffold = buildScaffoldPlan(ctx)
    expect(scaffold.writes.some((write) => write.path === configPath)).toBe(false)
    expect(scaffold.notes.join('\n')).toContain('deferred atomically to the routes phase')
    expect((await scaffoldPhase.apply(scaffold, ctx)).state).toBe('done')
    expect(await scaffoldPhase.detect(ctx)).toBe('done')
    expect(readFileSync(configPath, 'utf8')).not.toContain('signIn:')

    expect((await routesPhase.apply(buildRoutesPlan(ctx), ctx)).state).toBe('done')
    expect(readFileSync(configPath, 'utf8')).toContain("signIn: '/staff/login'")
    expect(await routesPhase.detect(ctx)).toBe('done')
    expect(await scaffoldPhase.detect(ctx)).toBe('done')
  })

  it('excludes import helper tests while including the optional helper implementation', () => {
    const ctx = fixture({ examples: true, importDocs: true })
    const plan = buildScaffoldPlan(ctx)
    expect(plan.writes.some((write) => write.path.endsWith('scripts/import-docs.ts'))).toBe(true)
    expect(
      plan.writes.some(
        (write) => write.path.includes('/scripts/') && write.path.endsWith('.test.node.ts')
      )
    ).toBe(false)
  })

  it('does not scaffold package-owned boundary tests or script helper tests', () => {
    const ctx = fixture({ examples: true, importDocs: true })
    const plan = buildScaffoldPlan(ctx)
    expect(
      plan.writes.some(
        (write) =>
          write.path.endsWith('client-hook-boundary.test.node.ts') ||
          (write.path.includes('/scripts/') && write.path.endsWith('.test.node.ts'))
      )
    ).toBe(false)
  })

  it('patches a recognized Turbo task map and leaves unknown config manual', () => {
    const ctx = fixture({ examples: false })
    writeFileSync(ctx.resolve('turbo.json'), '{"tasks":{"typecheck":{"outputs":[]}}}\n')
    let plan = buildScaffoldPlan(ctx)
    const turboWrite = plan.writes.find((write) => write.path.endsWith('turbo.json'))
    expect(turboWrite?.contents).toContain('byline:generate:check')

    writeFileSync(ctx.resolve('turbo.json'), '{ // jsonc\n"tasks": {}\n}\n')
    plan = buildScaffoldPlan(ctx)
    expect(plan.writes.some((write) => write.path.endsWith('turbo.json'))).toBe(false)
    expect(plan.notes.join('\n')).toContain('manual')
  })

  it('keeps known CI without generation checking partial across reruns', async () => {
    const ctx = fixture({ examples: false })
    mkdirSync(ctx.resolve('.github/workflows'), { recursive: true })
    writeFileSync(
      ctx.resolve('.github/workflows/ci.yml'),
      'steps:\n  # TODO: add byline:generate:check\n  - run: pnpm typecheck\n'
    )
    const plan = buildScaffoldPlan(ctx)
    expect(plan.notes.join('\n')).toContain('manual')
    expect((await scaffoldPhase.apply(plan, ctx)).state).toBe('partial')
    expect(await scaffoldPhase.detect(ctx)).toBe('pending')

    writeFileSync(
      ctx.resolve('.github/workflows/ci.yml'),
      'steps:\n  - run: pnpm byline:generate:check\n'
    )
    expect(await scaffoldPhase.detect(ctx)).toBe('done')
  })

  it('applies a recognized missing Turbo task but keeps unknown Turbo config partial', async () => {
    const recognized = fixture({ examples: false })
    writeFileSync(recognized.resolve('turbo.json'), '{"tasks":{"typecheck":{}}}\n')
    expect((await scaffoldPhase.apply(buildScaffoldPlan(recognized), recognized)).state).toBe(
      'done'
    )
    expect(await scaffoldPhase.detect(recognized)).toBe('done')

    const unknown = fixture({ examples: false })
    writeFileSync(unknown.resolve('turbo.json'), '{ // jsonc\n"tasks": {}\n}\n')
    expect((await scaffoldPhase.apply(buildScaffoldPlan(unknown), unknown)).state).toBe('partial')
    expect(await scaffoldPhase.detect(unknown)).toBe('pending')
  })

  it('preserves a divergent generation script and reports it as manual', () => {
    const ctx = fixture({ examples: false })
    writeFileSync(
      ctx.resolve('package.json'),
      `${JSON.stringify({ scripts: { 'byline:generate': 'custom-generator' } }, null, 2)}\n`
    )
    const plan = buildScaffoldPlan(ctx)
    const packageWrite = plan.writes.find((write) => write.path.endsWith('package.json'))
    expect(packageWrite?.contents).toContain('custom-generator')
    expect(packageWrite?.contents).toContain('byline:generate:check')
    expect(plan.notes.join('\n')).toContain('manual')
  })

  it('structurally detects missing v3.21 artifacts despite a completed phase flag', async () => {
    const ctx = fixture({ examples: false })
    ctx.state.markPhaseComplete('scaffold')
    expect(await scaffoldPhase.detect(ctx)).toBe('pending')
    const plan = buildScaffoldPlan(ctx)
    await scaffoldPhase.apply(plan, ctx)
    expect(existsSync(ctx.resolve('byline/generated/collection-types.ts'))).toBe(true)
    expect(await scaffoldPhase.detect(ctx)).toBe('done')
  })
})

function previousReleaseRoutesSource(): string {
  return `/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * URL segments for admin and (future) public API routes. Defaults of
 * \`/admin\` and \`/api\` are applied automatically by \`resolveRoutes()\` —
 * keys only need to be set here when overriding either default.
 */

import type { RoutesConfig } from '@byline/core'

export const routes: Partial<RoutesConfig> = {
  admin: '/admin',
  api: '/api',
}

/**
 * Fallback used by both server and admin entry points when no
 * \`VITE_SERVER_URL\` env var is set. Each entry resolves the env var
 * itself (Vite's \`import.meta.env\` on the client, Node's \`process.env\`
 * on the server) and falls back to this literal.
 */
export const DEFAULT_SERVER_URL = 'http://localhost:5173/'
`
}
