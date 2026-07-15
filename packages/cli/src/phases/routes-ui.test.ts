import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'

import { afterEach, describe, expect, it } from 'vitest'

import { createTestContext } from '../test-helpers.js'
import { buildRoutesPlan, renameAdminSegment, routesPhase } from './routes.js'
import { buildUiPlan, isExampleOnlyUiPath, uiPhase } from './ui.js'
import type { Context } from '../context.js'

const contexts: Context[] = []
afterEach(() => {
  for (const ctx of contexts.splice(0)) rmSync(ctx.cwd, { recursive: true, force: true })
})

function fixture(answers: Parameters<typeof createTestContext>[0]): Context {
  const ctx = createTestContext(answers)
  contexts.push(ctx)
  return ctx
}

describe('routes planning', () => {
  it.each([
    ['/admin', 'admin'],
    ['/cms', 'cms'],
  ])('keeps filesystem route IDs and runtime config aligned for %s', async (adminPath, slug) => {
    const ctx = fixture({ adminPath })
    mkdirSync(ctx.resolve('byline'), { recursive: true })
    writeFileSync(
      ctx.resolve('byline/routes.ts'),
      readFileSync(`${ctx.templatesDir()}/byline-examples/routes.ts`, 'utf8')
    )
    const plan = buildRoutesPlan(ctx)
    expect(plan.writes.length).toBeGreaterThan(0)
    await routesPhase.apply(plan, ctx)
    for (const write of plan.writes) expect(readFileSync(write.path, 'utf8')).toBe(write.contents)
    expect(existsSync(ctx.resolve(`src/routes/_byline/${slug}/route.tsx`))).toBe(true)
    expect(readFileSync(ctx.resolve('byline/routes.ts'), 'utf8')).toContain(`admin: '${adminPath}'`)
  })

  it('normalizes backslash route paths before renaming', () => {
    expect(renameAdminSegment('admin\\users\\index.tsx', 'cms')).toBe('cms/users/index.tsx')
    expect(renameAdminSegment('sign-in.tsx', 'cms')).toBe('sign-in.tsx')
  })

  it('only patches an exact canonical runtime routes predecessor', () => {
    const ctx = fixture({ adminPath: '/cms' })
    const path = ctx.resolve('byline/routes.ts')
    mkdirSync(ctx.resolve('byline'), { recursive: true })
    const canonical = readFileSync(`${ctx.templatesDir()}/byline-examples/routes.ts`, 'utf8')
    writeFileSync(path, `${canonical}\n// user-owned comment\n`)
    const plan = buildRoutesPlan(ctx)
    expect(plan.writes.some((write) => write.path === path)).toBe(false)
    expect(plan.notes.join('\n')).toContain('manual')
  })

  it('reports a divergent runtime routes file as manual without overwriting it', async () => {
    const ctx = fixture({ adminPath: '/cms' })
    const path = ctx.resolve('byline/routes.ts')
    mkdirSync(ctx.resolve('byline'), { recursive: true })
    writeFileSync(path, "export const routes = getMyRoutes('/private')\n")
    const plan = buildRoutesPlan(ctx)
    expect(plan.notes.join('\n')).toContain('manual')
    expect((await routesPhase.apply(plan, ctx)).state).toBe('partial')
    expect(readFileSync(path, 'utf8')).toContain('getMyRoutes')
  })
})

describe('UI planning', () => {
  it('normalizes backslash paths before example-only filtering', () => {
    expect(isExampleOnlyUiPath('blocks\\photo-block\\index.tsx')).toBe(true)
    expect(isExampleOnlyUiPath('types\\content.ts')).toBe(true)
    expect(isExampleOnlyUiPath('components\\code\\index.ts')).toBe(false)
  })

  it('includes example block UI only when examples are installed', async () => {
    const withExamples = fixture({ examples: true })
    const examplePlan = buildUiPlan(withExamples)
    expect(examplePlan.writes.some((write) => write.path.endsWith('render-blocks.tsx'))).toBe(true)

    const withoutExamples = fixture({ examples: false })
    const portablePlan = buildUiPlan(withoutExamples)
    expect(portablePlan.writes.some((write) => write.path.endsWith('render-blocks.tsx'))).toBe(
      false
    )
    expect(portablePlan.writes.some((write) => write.path.includes('/blocks/'))).toBe(false)
    expect(portablePlan.writes.every((write) => !write.contents.includes('@/i18n/'))).toBe(true)
    await uiPhase.apply(portablePlan, withoutExamples)
    for (const write of portablePlan.writes) {
      expect(readFileSync(write.path, 'utf8')).toBe(write.contents)
    }
  })
})
