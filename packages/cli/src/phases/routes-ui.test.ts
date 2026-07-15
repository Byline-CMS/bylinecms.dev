import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'

import { afterEach, describe, expect, it } from 'vitest'

import { createTestContext } from '../test-helpers.js'
import { promptsPhase } from './prompts.js'
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

async function prepareExistingDestinationMigration(ctx: Context) {
  await routesPhase.apply(buildRoutesPlan(ctx), ctx)
  const oldPath = ctx.resolve('src/routes/_byline/auth/login.tsx')
  const nextPath = ctx.resolve('src/routes/_byline/staff/login.tsx')
  mkdirSync(ctx.resolve('src/routes/_byline/staff'), { recursive: true })
  const destination = readFileSync(
    `${ctx.templatesDir()}/routes/_byline/sign-in.tsx`,
    'utf8'
  ).replace('/_byline/sign-in', '/_byline/staff/login')
  writeFileSync(nextPath, destination)
  ctx.state.patchAnswers({ signInPath: '/staff/login' })
  return { oldPath, nextPath, configPath: ctx.resolve('byline/routes.ts'), destination }
}

describe('routes planning', () => {
  it('collects and persists canonical default route paths', async () => {
    const ctx = fixture({})
    expect((await promptsPhase.apply(await promptsPhase.plan(ctx), ctx)).state).toBe('done')
    expect(ctx.state.get().answers.adminPath).toBe('/admin')
    expect(ctx.state.get().answers.signInPath).toBe('/sign-in')
  })

  it('persists canonical custom route answers', async () => {
    const ctx = fixture({ adminPath: 'cms/', signInPath: 'staff//login/' })
    expect((await promptsPhase.apply(await promptsPhase.plan(ctx), ctx)).state).toBe('done')
    expect(ctx.state.get().answers.adminPath).toBe('/cms')
    expect(ctx.state.get().answers.signInPath).toBe('/staff/login')
  })

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
    expect(existsSync(ctx.resolve('src/routes/_byline/sign-in.tsx'))).toBe(true)
    expect(readFileSync(ctx.resolve('src/routes/_byline/sign-in.tsx'), 'utf8')).toContain(
      "createSignInRoute('/_byline/sign-in')"
    )
    expect(readFileSync(ctx.resolve('byline/routes.ts'), 'utf8')).toContain("signIn: '/sign-in'")
  })

  it('generates a nested custom sign-in route whose file, ID, and config agree', async () => {
    const ctx = fixture({ adminPath: '/cms', signInPath: '/staff/login' })
    const plan = buildRoutesPlan(ctx)
    const signInPath = ctx.resolve('src/routes/_byline/staff/login.tsx')
    const signInWrite = plan.writes.find((write) => write.path === signInPath)
    expect(signInWrite?.contents).toContain("createSignInRoute('/_byline/staff/login')")
    expect(plan.notes).toContain('sign-in path: /staff/login')

    expect((await routesPhase.apply(plan, ctx)).state).toBe('done')
    expect(existsSync(signInPath)).toBe(true)
    expect(existsSync(ctx.resolve('src/routes/_byline/sign-in.tsx'))).toBe(false)
    expect(readFileSync(ctx.resolve('byline/routes.ts'), 'utf8')).toContain(
      "signIn: '/staff/login'"
    )
    expect(await routesPhase.detect(ctx)).toBe('done')
  })

  it('normalizes backslash route paths before renaming', () => {
    expect(renameAdminSegment('admin\\users\\index.tsx', 'cms')).toBe('cms/users/index.tsx')
    expect(renameAdminSegment('sign-in.tsx', 'cms')).toBe('sign-in.tsx')
  })

  it('canonicalizes leading and trailing slashes before writing runtime config', async () => {
    const ctx = fixture({ adminPath: 'cms/', signInPath: 'staff//login/' })
    mkdirSync(ctx.resolve('byline'), { recursive: true })
    writeFileSync(
      ctx.resolve('byline/routes.ts'),
      readFileSync(`${ctx.templatesDir()}/byline-examples/routes.ts`, 'utf8')
    )
    const plan = buildRoutesPlan(ctx)
    await routesPhase.apply(plan, ctx)
    expect(readFileSync(ctx.resolve('byline/routes.ts'), 'utf8')).toContain("admin: '/cms'")
    expect(readFileSync(ctx.resolve('byline/routes.ts'), 'utf8')).toContain(
      "signIn: '/staff/login'"
    )
    expect(ctx.state.get().answers.adminPath).toBe('/cms')
    expect(ctx.state.get().answers.signInPath).toBe('/staff/login')
  })

  it.each([
    '/sign-in',
    '/_serverFn',
    '/_build',
    '/uploads',
    '/api',
    '/static',
    '/public',
    '/en',
    '/fr',
  ])('rejects the reserved admin path %s', (adminPath) => {
    const ctx = fixture({ adminPath })
    const plan = buildRoutesPlan(ctx)
    expect(plan.writes).toEqual([])
    expect(plan.notes.join('\n')).toMatch(/invalid admin path/)
  })

  it('rejects configured API and public locale route conflicts', () => {
    const apiCtx = fixture({ adminPath: '/rpc' })
    mkdirSync(apiCtx.resolve('byline'), { recursive: true })
    writeFileSync(
      apiCtx.resolve('byline/routes.ts'),
      "export const routes = { admin: '/admin', api: '/rpc' }\n"
    )
    expect(buildRoutesPlan(apiCtx).notes.join('\n')).toContain('conflicts')

    const signInApiCtx = fixture({ adminPath: '/cms', signInPath: '/rpc/login' })
    mkdirSync(signInApiCtx.resolve('byline'), { recursive: true })
    writeFileSync(
      signInApiCtx.resolve('byline/routes.ts'),
      "export const routes = { admin: '/admin', api: '/rpc', signIn: '/sign-in' }\n"
    )
    expect(buildRoutesPlan(signInApiCtx).notes.join('\n')).toContain('conflicts')

    const localeCtx = fixture({ adminPath: '/pt' })
    mkdirSync(localeCtx.resolve('byline'), { recursive: true })
    writeFileSync(
      localeCtx.resolve('byline/locales.ts'),
      "export const contentLocales = [{ code: 'pt', label: 'Português' }]\n"
    )
    expect(buildRoutesPlan(localeCtx).notes.join('\n')).toContain('conflicts')

    const signInCtx = fixture({ adminPath: '/staff', signInPath: '/staff/login' })
    mkdirSync(signInCtx.resolve('byline'), { recursive: true })
    writeFileSync(
      signInCtx.resolve('byline/routes.ts'),
      "export const routes = { admin: '/admin', signIn: '/staff/login' }\n"
    )
    expect(buildRoutesPlan(signInCtx).notes.join('\n')).toContain('conflicts')
  })

  it.each([
    ['/cms', '/cms/login'],
    ['/cms', '/api/login'],
    ['/cms', '/en/login'],
    ['/cms', '/uploads/login'],
    ['/cms', '/staff/index'],
    ['/cms', 'https://evil.test/login'],
    ['/cms', '/staff/%6cogin'],
  ])('rejects the conflicting or unsafe sign-in path %s', (adminPath, signInPath) => {
    const ctx = fixture({ adminPath, signInPath })
    expect(buildRoutesPlan(ctx).writes).toEqual([])
    expect(buildRoutesPlan(ctx).notes.join('\n')).toMatch(/invalid (?:admin|sign-in) path/)
  })

  it('atomically moves a canonical default sign-in route to a custom nested path', async () => {
    const ctx = fixture({ adminPath: '/admin', signInPath: '/sign-in' })
    await routesPhase.apply(buildRoutesPlan(ctx), ctx)
    const oldPath = ctx.resolve('src/routes/_byline/sign-in.tsx')
    const nextPath = ctx.resolve('src/routes/_byline/staff/login.tsx')
    ctx.state.patchAnswers({ signInPath: '/staff/login' })

    const plan = buildRoutesPlan(ctx)
    expect(plan.writes).toContainEqual(expect.objectContaining({ path: oldPath, mode: 'delete' }))
    expect(plan.writes).toContainEqual(expect.objectContaining({ path: nextPath, mode: 'create' }))
    expect((await routesPhase.apply(plan, ctx)).state).toBe('done')
    expect(existsSync(oldPath)).toBe(false)
    expect(existsSync(nextPath)).toBe(true)
  })

  it('atomically migrates the exact pre-signIn generated config and default route', async () => {
    const ctx = fixture({ signInPath: '/staff/login' })
    const configPath = ctx.resolve('byline/routes.ts')
    const oldPath = ctx.resolve('src/routes/_byline/sign-in.tsx')
    const nextPath = ctx.resolve('src/routes/_byline/staff/login.tsx')
    mkdirSync(ctx.resolve('byline'), { recursive: true })
    mkdirSync(ctx.resolve('src/routes/_byline'), { recursive: true })
    const canonicalConfig = readFileSync(`${ctx.templatesDir()}/byline-examples/routes.ts`, 'utf8')
    writeFileSync(configPath, preSignInRoutesSource(canonicalConfig))
    writeFileSync(oldPath, readFileSync(`${ctx.templatesDir()}/routes/_byline/sign-in.tsx`, 'utf8'))

    const plan = buildRoutesPlan(ctx)
    const configWriteIndex = plan.writes.findIndex((write) => write.path === configPath)
    const oldDeleteIndex = plan.writes.findIndex(
      (write) => write.path === oldPath && write.mode === 'delete'
    )
    expect(configWriteIndex).toBeGreaterThanOrEqual(0)
    expect(oldDeleteIndex).toBeGreaterThan(configWriteIndex)
    expect(plan.writes).toContainEqual(expect.objectContaining({ path: nextPath, mode: 'create' }))

    expect((await routesPhase.apply(plan, ctx)).state).toBe('done')
    expect(readFileSync(configPath, 'utf8')).toContain("signIn: '/staff/login'")
    expect(existsSync(oldPath)).toBe(false)
    expect(existsSync(nextPath)).toBe(true)
    expect(await routesPhase.detect(ctx)).toBe('done')
  })

  it('atomically migrates one generated custom sign-in route to another', async () => {
    const ctx = fixture({ signInPath: '/auth/login' })
    await routesPhase.apply(buildRoutesPlan(ctx), ctx)
    const oldPath = ctx.resolve('src/routes/_byline/auth/login.tsx')
    const nextPath = ctx.resolve('src/routes/_byline/staff/login.tsx')
    ctx.state.patchAnswers({ signInPath: '/staff/login' })

    const plan = buildRoutesPlan(ctx)
    expect(plan.writes).toContainEqual(expect.objectContaining({ path: nextPath, mode: 'create' }))
    expect(plan.writes).toContainEqual(expect.objectContaining({ path: oldPath, mode: 'delete' }))
    expect((await routesPhase.apply(plan, ctx)).state).toBe('done')
    expect(existsSync(oldPath)).toBe(false)
    expect(existsSync(nextPath)).toBe(true)
    expect(readFileSync(ctx.resolve('byline/routes.ts'), 'utf8')).toContain(
      "signIn: '/staff/login'"
    )
  })

  it('migrates successfully when the generated destination already exists unchanged', async () => {
    const ctx = fixture({ signInPath: '/auth/login' })
    const { oldPath, nextPath, configPath, destination } =
      await prepareExistingDestinationMigration(ctx)
    const plan = buildRoutesPlan(ctx)
    expect(plan.writes.some((write) => write.path === nextPath)).toBe(false)
    expect(plan.preconditions).toContainEqual({
      type: 'file',
      path: nextPath,
      contents: destination,
    })

    expect((await routesPhase.apply(plan, ctx)).state).toBe('done')
    expect(existsSync(oldPath)).toBe(false)
    expect(readFileSync(nextPath, 'utf8')).toBe(destination)
    expect(readFileSync(configPath, 'utf8')).toContain("signIn: '/staff/login'")
  })

  it('blocks every migration write when an existing destination disappears after preview', async () => {
    const ctx = fixture({ signInPath: '/auth/login' })
    const { oldPath, nextPath, configPath } = await prepareExistingDestinationMigration(ctx)
    const plan = buildRoutesPlan(ctx)
    rmSync(nextPath)

    expect((await routesPhase.apply(plan, ctx)).state).toBe('partial')
    expect(existsSync(oldPath)).toBe(true)
    expect(existsSync(nextPath)).toBe(false)
    expect(readFileSync(configPath, 'utf8')).toContain("signIn: '/auth/login'")
  })

  it('blocks every migration write when an existing destination mutates after preview', async () => {
    const ctx = fixture({ signInPath: '/auth/login' })
    const { oldPath, nextPath, configPath, destination } =
      await prepareExistingDestinationMigration(ctx)
    const plan = buildRoutesPlan(ctx)
    writeFileSync(nextPath, `${destination}\n// concurrent edit\n`)

    expect((await routesPhase.apply(plan, ctx)).state).toBe('partial')
    expect(existsSync(oldPath)).toBe(true)
    expect(readFileSync(nextPath, 'utf8')).toContain('concurrent edit')
    expect(readFileSync(configPath, 'utf8')).toContain("signIn: '/auth/login'")
  })

  it('applies no part of a stale custom-to-custom migration plan', async () => {
    const ctx = fixture({ signInPath: '/auth/login' })
    await routesPhase.apply(buildRoutesPlan(ctx), ctx)
    const configPath = ctx.resolve('byline/routes.ts')
    const oldPath = ctx.resolve('src/routes/_byline/auth/login.tsx')
    const nextPath = ctx.resolve('src/routes/_byline/staff/login.tsx')
    ctx.state.patchAnswers({ signInPath: '/staff/login' })
    const plan = buildRoutesPlan(ctx)
    writeFileSync(configPath, `${readFileSync(configPath, 'utf8')}\n// concurrent edit\n`)

    expect((await routesPhase.apply(plan, ctx)).state).toBe('partial')
    expect(existsSync(oldPath)).toBe(true)
    expect(existsSync(nextPath)).toBe(false)
    expect(readFileSync(configPath, 'utf8')).toContain("signIn: '/auth/login'")
  })

  it('leaves generated routes intact when runtime config is user-owned', async () => {
    const ctx = fixture({ signInPath: '/auth/login' })
    await routesPhase.apply(buildRoutesPlan(ctx), ctx)
    const configPath = ctx.resolve('byline/routes.ts')
    const oldPath = ctx.resolve('src/routes/_byline/auth/login.tsx')
    const nextPath = ctx.resolve('src/routes/_byline/staff/login.tsx')
    writeFileSync(configPath, `${readFileSync(configPath, 'utf8')}\n// user-owned\n`)
    ctx.state.patchAnswers({ signInPath: '/staff/login' })

    const plan = buildRoutesPlan(ctx)
    expect(plan.notes.join('\n')).toContain('user-owned routes.ts')
    expect(plan.writes.some((write) => write.path === configPath)).toBe(false)
    expect(plan.writes.some((write) => write.path === oldPath)).toBe(false)
    expect(plan.writes.some((write) => write.path === nextPath)).toBe(false)
    expect((await routesPhase.apply(plan, ctx)).state).toBe('partial')
    expect(existsSync(oldPath)).toBe(true)
    expect(existsSync(nextPath)).toBe(false)
    expect(readFileSync(configPath, 'utf8')).toContain("signIn: '/auth/login'")
  })

  it('leaves config and routes intact when the prior route is user-owned', async () => {
    const ctx = fixture({ signInPath: '/auth/login' })
    await routesPhase.apply(buildRoutesPlan(ctx), ctx)
    const configPath = ctx.resolve('byline/routes.ts')
    const oldPath = ctx.resolve('src/routes/_byline/auth/login.tsx')
    const nextPath = ctx.resolve('src/routes/_byline/staff/login.tsx')
    writeFileSync(oldPath, `${readFileSync(oldPath, 'utf8')}\n// user-owned\n`)
    ctx.state.patchAnswers({ signInPath: '/staff/login' })

    const plan = buildRoutesPlan(ctx)
    expect(plan.notes.join('\n')).toContain('sign-in route is user-owned')
    expect(plan.writes.some((write) => write.path === configPath)).toBe(false)
    expect(plan.writes.some((write) => write.path === oldPath)).toBe(false)
    expect(plan.writes.some((write) => write.path === nextPath)).toBe(false)
    expect((await routesPhase.apply(plan, ctx)).state).toBe('partial')
    expect(existsSync(oldPath)).toBe(true)
    expect(existsSync(nextPath)).toBe(false)
    expect(readFileSync(configPath, 'utf8')).toContain("signIn: '/auth/login'")
  })

  it('applies no part of a stale sign-in move plan', async () => {
    const ctx = fixture({ signInPath: '/sign-in' })
    await routesPhase.apply(buildRoutesPlan(ctx), ctx)
    const oldPath = ctx.resolve('src/routes/_byline/sign-in.tsx')
    const nextPath = ctx.resolve('src/routes/_byline/staff/login.tsx')
    ctx.state.patchAnswers({ signInPath: '/staff/login' })
    const plan = buildRoutesPlan(ctx)
    writeFileSync(oldPath, `${readFileSync(oldPath, 'utf8')}\n// user edit\n`)

    expect((await routesPhase.apply(plan, ctx)).state).toBe('partial')
    expect(existsSync(oldPath)).toBe(true)
    expect(existsSync(nextPath)).toBe(false)
    expect(readFileSync(ctx.resolve('byline/routes.ts'), 'utf8')).toContain("signIn: '/sign-in'")
  })

  it('preserves a user-owned old sign-in route and reports manual cleanup', async () => {
    const ctx = fixture({ signInPath: '/staff/login' })
    const oldPath = ctx.resolve('src/routes/_byline/sign-in.tsx')
    mkdirSync(ctx.resolve('src/routes/_byline'), { recursive: true })
    writeFileSync(oldPath, 'export const Route = getMySignInRoute()\n')

    const plan = buildRoutesPlan(ctx)
    expect(plan.writes.some((write) => write.path === oldPath)).toBe(false)
    expect(plan.notes.join('\n')).toContain('existing sign-in route was preserved')
    expect((await routesPhase.apply(plan, ctx)).state).toBe('partial')
    expect(readFileSync(oldPath, 'utf8')).toContain('getMySignInRoute')
    expect(existsSync(ctx.resolve('src/routes/_byline/staff/login.tsx'))).toBe(true)
  })

  it('publishes sign-in as client-safe route configuration', () => {
    const ctx = fixture({ adminPath: '/admin' })
    const routesSource = readFileSync(`${ctx.templatesDir()}/byline/routes.ts`, 'utf8')
    const publicSource = readFileSync(`${ctx.templatesDir()}/byline/public.ts`, 'utf8')
    expect(routesSource).toContain("signIn: '/sign-in'")
    expect(publicSource).toContain("export { routes } from './routes.js'")
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

  it('generates every admin surface under the custom filesystem route ID', () => {
    const ctx = fixture({ adminPath: '/cms' })
    const plan = buildRoutesPlan(ctx)
    const routes = new Map(
      plan.writes
        .filter((write) => write.path.includes('/src/routes/_byline/cms/'))
        .map((write) => [write.path.slice(write.path.indexOf('/cms/') + 5), write.contents])
    )

    for (const route of [
      'route.tsx',
      'index.tsx',
      'collections/$collection/index.tsx',
      'collections/$collection/create.tsx',
      'collections/$collection/$id/index.tsx',
      'collections/$collection/$id/history.tsx',
      'collections/$collection/$id/api.tsx',
      'users/index.tsx',
      'users/$id/index.tsx',
      'roles/index.tsx',
      'roles/$id/index.tsx',
      'permissions/index.tsx',
      'activity/index.tsx',
      'account/index.tsx',
    ]) {
      expect(routes.get(route), route).toContain('/_byline/cms')
      expect(routes.get(route), route).not.toContain('/_byline/admin')
    }
  })

  it('keeps example media navigation on the resolved admin mount', () => {
    const ctx = fixture({ adminPath: '/cms', examples: true })
    const source = readFileSync(
      `${ctx.templatesDir()}/byline-examples/collections/media/components/media-list-view.tsx`,
      'utf8'
    )
    expect(source).toContain("getAdminRoutePath('collections', '$collection')")
    expect(source).toContain("getAdminRoutePath('collections', '$collection', 'create')")
    expect(source).toContain("getAdminRoutePath('collections', '$collection', '$id')")
    expect(source).not.toContain("'/admin/collections")
    expect(source).not.toContain('"/admin/collections')
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

function preSignInRoutesSource(canonical: string): string {
  return canonical
    .replace(
      `/**
 * Client-safe URL paths for admin, sign-in, and the future public API.
 * \`resolveRoutes()\` applies defaults and canonicalizes every consumer.
 */`,
      `/**
 * URL segments for admin and (future) public API routes. Defaults of
 * \`/admin\` and \`/api\` are applied automatically by \`resolveRoutes()\` —
 * keys only need to be set here when overriding either default.
 */`
    )
    .replace(/^\s*signIn:.*\n/m, '')
}

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
