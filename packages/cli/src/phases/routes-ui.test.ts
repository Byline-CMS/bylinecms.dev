import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'

import { afterEach, describe, expect, it } from 'vitest'

import { PREVIOUS_RELEASE_ROUTES_SOURCE, readStaticRoutesSource } from '../lib/route-config.js'
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

  it('installs a multi-segment admin tree with matching files, IDs, and config', async () => {
    const ctx = fixture({ adminPath: '/internal/cms' })
    const plan = buildRoutesPlan(ctx)
    const adminRoute = ctx.resolve('src/routes/_byline/internal/cms/route.tsx')
    const adminWrite = plan.writes.find((write) => write.path === adminRoute)

    expect(adminWrite?.contents).toContain("'/_byline/internal/cms'")
    expect((await routesPhase.apply(plan, ctx)).state).toBe('done')
    expect(existsSync(adminRoute)).toBe(true)
    expect(readFileSync(ctx.resolve('byline/routes.ts'), 'utf8')).toContain(
      "admin: '/internal/cms'"
    )
    expect(await routesPhase.detect(ctx)).toBe('done')
  })

  it.each(['directory', 'dangling symlink'] as const)(
    'blocks all route writes when an expected target is a %s',
    async (kind) => {
      const ctx = fixture({ adminPath: '/admin' })
      const routePath = ctx.resolve('src/routes/_byline/admin/route.tsx')
      mkdirSync(ctx.resolve('src/routes/_byline/admin'), { recursive: true })
      if (kind === 'directory') mkdirSync(routePath)
      else symlinkSync(ctx.resolve('outside/missing-route.tsx'), routePath)

      const plan = buildRoutesPlan(ctx)
      expect(plan.writes).toEqual([])
      expect(plan.notes.join('\n')).toContain('not a regular file')
      expect((await routesPhase.apply(plan, ctx)).state).toBe('partial')
      expect(existsSync(ctx.resolve('byline/routes.ts'))).toBe(false)
    }
  )

  it('accepts safe shared-prefix sibling admin, API, and sign-in trees', () => {
    const ctx = fixture({ adminPath: '/internal/cms', signInPath: '/internal/login' })
    mkdirSync(ctx.resolve('byline'), { recursive: true })
    writeFileSync(
      ctx.resolve('byline/routes.ts'),
      `export const routes = {
        admin: '/internal/cms',
        api: '/internal/api',
        signIn: '/internal/login',
      } as const
      `
    )

    const plan = buildRoutesPlan(ctx)
    expect(plan.notes.join('\n')).not.toMatch(/invalid .* path/)
    expect(
      plan.writes.some((write) => write.path.endsWith('src/routes/_byline/internal/cms/route.tsx'))
    ).toBe(true)
  })

  it.each(['/bad/%api', '/internal/../api', '/internal api', '/internal/route'])(
    'fails closed for invalid configured API path %s',
    (api) => {
      const ctx = fixture({ adminPath: '/cms' })
      mkdirSync(ctx.resolve('byline'), { recursive: true })
      writeFileSync(
        ctx.resolve('byline/routes.ts'),
        `export const routes = { admin: '/cms', api: '${api}', signIn: '/sign-in' }\n`
      )

      const plan = buildRoutesPlan(ctx)
      expect(plan.writes).toEqual([])
      expect(plan.notes.join('\n')).toContain('invalid API path')
    }
  )

  it('normalizes backslash route paths before renaming', () => {
    expect(renameAdminSegment('admin\\users\\index.tsx', ['internal', 'cms'])).toBe(
      'internal/cms/users/index.tsx'
    )
    expect(renameAdminSegment('sign-in.tsx', ['internal', 'cms'])).toBe('sign-in.tsx')
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

  it('ignores comments, unrelated values, and interface locale definitions', () => {
    const ctx = fixture({ adminPath: '/cms' })
    mkdirSync(ctx.resolve('byline'), { recursive: true })
    writeFileSync(
      ctx.resolve('byline/routes.ts'),
      `
        // api: '/cms'
        const unrelated = { api: '/cms', defaultLocale: 'cms' }
        export const routes = {
          admin: '/cms',
          api: '/rpc',
          signIn: '/sign-in',
          unrelated: doNotExecute(),
        }
      `
    )
    writeFileSync(
      ctx.resolve('byline/locales.ts'),
      `
        export const interfaceLocales = [{ code: 'cms', label: 'Ignored' }]
        export const contentLocales = [{ code: 'en', label: translateAtRuntime() }] as const
      `
    )

    const plan = buildRoutesPlan(ctx)
    expect(plan.notes.join('\n')).not.toContain('conflicts')
    expect(plan.writes.some((write) => write.path === ctx.resolve('byline/routes.ts'))).toBe(false)
  })

  it('resolves safe constants, wrappers, and the recognized core resolveRoutes call', () => {
    const ctx = fixture({ adminPath: '/cms', signInPath: '/staff/login' })
    mkdirSync(ctx.resolve('byline'), { recursive: true })
    writeFileSync(
      ctx.resolve('byline/routes.ts'),
      `
        import { resolveRoutes } from '@byline/core'
        const admin = '/cms'
        const base = ({ admin, api: '/rpc' } as const)
        const signIn = '/staff/login' as const
        export const routes = resolveRoutes(
          ({ ...base, signIn } as const) satisfies Record<string, string>
        )
      `
    )

    const plan = buildRoutesPlan(ctx)
    expect(plan.writes.length).toBeGreaterThan(0)
    expect(plan.writes.some((write) => write.path === ctx.resolve('byline/routes.ts'))).toBe(false)
    expect(plan.notes.join('\n')).not.toContain('manual')
  })

  it.each([
    "import { routes } from './shared.js'; export { routes }",
    "const key = 'admin'; export const routes = { [key]: '/cms', signIn: '/sign-in' }",
  ])('fails closed without route writes for unknown relevant config', (source) => {
    const ctx = fixture({ adminPath: '/cms' })
    mkdirSync(ctx.resolve('byline'), { recursive: true })
    writeFileSync(ctx.resolve('byline/routes.ts'), source)

    const plan = buildRoutesPlan(ctx)
    expect(plan.writes).toEqual([])
    expect(plan.notes.join('\n')).toContain('cannot safely resolve route configuration')
  })

  it('fails closed when public locale config depends on imported values', () => {
    const ctx = fixture({ adminPath: '/cms' })
    mkdirSync(ctx.resolve('src/i18n'), { recursive: true })
    writeFileSync(
      ctx.resolve('src/i18n/i18n-config.ts'),
      `
        import { locales } from './shared.js'
        export const i18nConfig = { locales, defaultLocale: 'en' }
      `
    )

    const plan = buildRoutesPlan(ctx)
    expect(plan.writes).toEqual([])
    expect(plan.notes.join('\n')).toContain('cannot safely resolve route configuration')
  })

  it('reserves statically resolved public locales and their default', () => {
    const ctx = fixture({ adminPath: '/it' })
    mkdirSync(ctx.resolve('src/i18n'), { recursive: true })
    writeFileSync(
      ctx.resolve('src/i18n/i18n-config.ts'),
      `
        const locales = ['en', ...(['fr'] as const)] as const
        const defaults = { defaultLocale: 'it' } as const
        export const i18nConfig = ({ locales, ...defaults } as const) satisfies object
      `
    )

    const plan = buildRoutesPlan(ctx)
    expect(plan.writes).toEqual([])
    expect(plan.notes.join('\n')).toContain('conflicts')
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

  it('atomically migrates the literal previous-release config and default route', async () => {
    const ctx = fixture({ signInPath: '/staff/login' })
    const configPath = ctx.resolve('byline/routes.ts')
    const oldPath = ctx.resolve('src/routes/_byline/sign-in.tsx')
    const nextPath = ctx.resolve('src/routes/_byline/staff/login.tsx')
    mkdirSync(ctx.resolve('byline'), { recursive: true })
    mkdirSync(ctx.resolve('src/routes/_byline'), { recursive: true })
    writeFileSync(configPath, previousReleaseRoutesSource())
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

  it.each([
    ['/admin', '/admin'],
    ['/cms', '/cms'],
  ])(
    'rewrites the literal v3.21 routes source when its %s admin path is already aligned',
    async (adminPath, expectedAdminPath) => {
      const ctx = fixture({ adminPath })
      const configPath = ctx.resolve('byline/routes.ts')
      mkdirSync(ctx.resolve('byline'), { recursive: true })
      writeFileSync(
        configPath,
        previousReleaseRoutesSource().replace("admin: '/admin'", `admin: '${adminPath}'`)
      )

      const plan = buildRoutesPlan(ctx)
      expect(plan.writes).toContainEqual(
        expect.objectContaining({ path: configPath, mode: 'patch' })
      )
      expect(plan.notes.join('\n')).not.toContain('manual')

      expect((await routesPhase.apply(plan, ctx)).state).toBe('done')
      const migrated = readFileSync(configPath, 'utf8')
      expect(migrated).toContain('resolveRoutes({')
      expect(migrated).toContain(`admin: '${expectedAdminPath}'`)
      expect(migrated).toContain("signIn: '/sign-in'")
    }
  )

  it('pins the recognized predecessor to the literal v3.21 source shape', () => {
    const literal = previousReleaseRoutesSource()
    expect(PREVIOUS_RELEASE_ROUTES_SOURCE).toBe(literal)
    expect(literal).not.toContain('signIn:')
    expect(readStaticRoutesSource(PREVIOUS_RELEASE_ROUTES_SOURCE)).toEqual({
      ok: true,
      value: { admin: '/admin', api: '/api', signIn: '/sign-in' },
    })
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

  it('atomically migrates and removes a recognized generated admin tree', async () => {
    const ctx = fixture({ adminPath: '/admin' })
    await routesPhase.apply(buildRoutesPlan(ctx), ctx)
    const oldRoute = ctx.resolve('src/routes/_byline/admin/route.tsx')
    const nextRoute = ctx.resolve('src/routes/_byline/internal/cms/route.tsx')
    ctx.state.patchAnswers({ adminPath: '/internal/cms' })

    const plan = buildRoutesPlan(ctx)
    expect(plan.writes).toContainEqual(expect.objectContaining({ path: oldRoute, mode: 'delete' }))
    expect(plan.writes).toContainEqual(expect.objectContaining({ path: nextRoute, mode: 'create' }))
    expect((await routesPhase.apply(plan, ctx)).state).toBe('done')
    expect(existsSync(oldRoute)).toBe(false)
    expect(existsSync(nextRoute)).toBe(true)
    expect(readFileSync(ctx.resolve('byline/routes.ts'), 'utf8')).toContain(
      "admin: '/internal/cms'"
    )
  })

  it('atomically migrates a generated admin tree into a nested descendant', async () => {
    const ctx = fixture({ adminPath: '/admin' })
    await routesPhase.apply(buildRoutesPlan(ctx), ctx)
    const oldRoute = ctx.resolve('src/routes/_byline/admin/route.tsx')
    const nextRoute = ctx.resolve('src/routes/_byline/admin/cms/route.tsx')
    ctx.state.patchAnswers({ adminPath: '/admin/cms' })

    const plan = buildRoutesPlan(ctx)
    expect(plan.writes).toContainEqual(expect.objectContaining({ path: oldRoute, mode: 'delete' }))
    expect(plan.writes).toContainEqual(expect.objectContaining({ path: nextRoute, mode: 'create' }))
    expect((await routesPhase.apply(plan, ctx)).state).toBe('done')
    expect(existsSync(oldRoute)).toBe(false)
    expect(existsSync(nextRoute)).toBe(true)
  })

  it('blocks every migration write when a destination is not a regular file', async () => {
    const ctx = fixture({ adminPath: '/admin' })
    await routesPhase.apply(buildRoutesPlan(ctx), ctx)
    const configPath = ctx.resolve('byline/routes.ts')
    const oldRoute = ctx.resolve('src/routes/_byline/admin/route.tsx')
    const nextRoute = ctx.resolve('src/routes/_byline/internal/cms/route.tsx')
    mkdirSync(nextRoute, { recursive: true })
    ctx.state.patchAnswers({ adminPath: '/internal/cms' })

    const plan = buildRoutesPlan(ctx)
    expect(plan.writes).toEqual([])
    expect(plan.notes.join('\n')).toContain('not a regular file')
    expect((await routesPhase.apply(plan, ctx)).state).toBe('partial')
    expect(existsSync(oldRoute)).toBe(true)
    expect(readFileSync(configPath, 'utf8')).toContain("admin: '/admin'")
  })

  it('migrates through a generated child-route collision in both directions', async () => {
    const ctx = fixture({ adminPath: '/admin' })
    await routesPhase.apply(buildRoutesPlan(ctx), ctx)
    const collidingPath = ctx.resolve('src/routes/_byline/admin/users/index.tsx')

    ctx.state.patchAnswers({ adminPath: '/admin/users' })
    const descendantPlan = buildRoutesPlan(ctx)
    expect(descendantPlan.notes.join('\n')).not.toContain('user-owned')
    expect(descendantPlan.writes).toContainEqual(
      expect.objectContaining({ path: collidingPath, mode: 'patch' })
    )
    expect((await routesPhase.apply(descendantPlan, ctx)).state).toBe('done')
    expect(readFileSync(collidingPath, 'utf8')).toContain('createAdminDashboardRoute')

    ctx.state.patchAnswers({ adminPath: '/admin' })
    const ancestorPlan = buildRoutesPlan(ctx)
    expect(ancestorPlan.notes.join('\n')).not.toContain('user-owned')
    expect(ancestorPlan.writes).toContainEqual(
      expect.objectContaining({ path: collidingPath, mode: 'patch' })
    )
    expect((await routesPhase.apply(ancestorPlan, ctx)).state).toBe('done')
    expect(readFileSync(collidingPath, 'utf8')).toContain('createAdminUsersListRoute')
  })

  it('blocks every admin migration write when an old tree file is user-owned', async () => {
    const ctx = fixture({ adminPath: '/admin' })
    await routesPhase.apply(buildRoutesPlan(ctx), ctx)
    const configPath = ctx.resolve('byline/routes.ts')
    const oldRoute = ctx.resolve('src/routes/_byline/admin/route.tsx')
    const nextRoute = ctx.resolve('src/routes/_byline/internal/cms/route.tsx')
    writeFileSync(oldRoute, `${readFileSync(oldRoute, 'utf8')}\n// user-owned\n`)
    ctx.state.patchAnswers({ adminPath: '/internal/cms' })

    const plan = buildRoutesPlan(ctx)
    expect(plan.writes).toEqual([])
    expect(plan.notes.join('\n')).toContain('user-owned')
    expect((await routesPhase.apply(plan, ctx)).state).toBe('partial')
    expect(existsSync(oldRoute)).toBe(true)
    expect(existsSync(nextRoute)).toBe(false)
    expect(readFileSync(configPath, 'utf8')).toContain("admin: '/admin'")
  })

  it('applies no part of a stale generated admin-tree migration plan', async () => {
    const ctx = fixture({ adminPath: '/admin' })
    await routesPhase.apply(buildRoutesPlan(ctx), ctx)
    const configPath = ctx.resolve('byline/routes.ts')
    const oldRoute = ctx.resolve('src/routes/_byline/admin/route.tsx')
    const nextRoute = ctx.resolve('src/routes/_byline/internal/cms/route.tsx')
    ctx.state.patchAnswers({ adminPath: '/internal/cms' })
    const plan = buildRoutesPlan(ctx)
    writeFileSync(oldRoute, `${readFileSync(oldRoute, 'utf8')}\n// concurrent edit\n`)

    expect((await routesPhase.apply(plan, ctx)).state).toBe('partial')
    expect(existsSync(oldRoute)).toBe(true)
    expect(existsSync(nextRoute)).toBe(false)
    expect(readFileSync(configPath, 'utf8')).toContain("admin: '/admin'")
  })

  it('applies no part of a migration when the old tree gains a file after preview', async () => {
    const ctx = fixture({ adminPath: '/admin' })
    await routesPhase.apply(buildRoutesPlan(ctx), ctx)
    const configPath = ctx.resolve('byline/routes.ts')
    const oldRoute = ctx.resolve('src/routes/_byline/admin/route.tsx')
    const nextRoute = ctx.resolve('src/routes/_byline/internal/cms/route.tsx')
    ctx.state.patchAnswers({ adminPath: '/internal/cms' })
    const plan = buildRoutesPlan(ctx)
    const lateRoute = ctx.resolve('src/routes/_byline/admin/custom.tsx')
    writeFileSync(lateRoute, 'export const Route = userRoute()\n')

    expect((await routesPhase.apply(plan, ctx)).state).toBe('partial')
    expect(existsSync(oldRoute)).toBe(true)
    expect(existsSync(nextRoute)).toBe(false)
    expect(readFileSync(configPath, 'utf8')).toContain("admin: '/admin'")
    expect(readFileSync(lateRoute, 'utf8')).toContain('userRoute')
  })

  it('revalidates an absent old admin tree before applying a migration', async () => {
    const ctx = fixture({ adminPath: '/admin' })
    await routesPhase.apply(buildRoutesPlan(ctx), ctx)
    const oldRoot = ctx.resolve('src/routes/_byline/admin')
    rmSync(oldRoot, { recursive: true })
    ctx.state.patchAnswers({ adminPath: '/internal/cms' })
    const plan = buildRoutesPlan(ctx)
    const lateRoute = ctx.resolve('src/routes/_byline/admin/custom.tsx')
    mkdirSync(oldRoot, { recursive: true })
    writeFileSync(lateRoute, 'export const Route = userRoute()\n')

    expect((await routesPhase.apply(plan, ctx)).state).toBe('partial')
    expect(existsSync(ctx.resolve('src/routes/_byline/internal/cms/route.tsx'))).toBe(false)
    expect(readFileSync(ctx.resolve('byline/routes.ts'), 'utf8')).toContain("admin: '/admin'")
    expect(readFileSync(lateRoute, 'utf8')).toContain('userRoute')
  })

  it('detects a stale generated admin tree after config migration', async () => {
    const ctx = fixture({ adminPath: '/admin' })
    await routesPhase.apply(buildRoutesPlan(ctx), ctx)
    const oldRoute = ctx.resolve('src/routes/_byline/admin/route.tsx')
    const oldSource = readFileSync(oldRoute, 'utf8')
    ctx.state.patchAnswers({ adminPath: '/internal/cms' })
    await routesPhase.apply(buildRoutesPlan(ctx), ctx)
    mkdirSync(ctx.resolve('src/routes/_byline/admin'), { recursive: true })
    writeFileSync(oldRoute, oldSource)

    expect(await routesPhase.detect(ctx)).toBe('pending')
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

  it('does not synthesize provenance from the current template with signIn removed', () => {
    const ctx = fixture({ signInPath: '/staff/login' })
    const path = ctx.resolve('byline/routes.ts')
    mkdirSync(ctx.resolve('byline'), { recursive: true })
    const canonical = readFileSync(`${ctx.templatesDir()}/byline-examples/routes.ts`, 'utf8')
    writeFileSync(path, canonical.replace(/^\s*signIn:.*\n/m, ''))

    const plan = buildRoutesPlan(ctx)
    expect(plan.writes).toEqual([])
    expect(plan.notes.join('\n')).toContain('user-owned routes.ts')
  })

  it('treats matching user-owned config as aligned without modifying it', async () => {
    const ctx = fixture({ adminPath: '/cms', signInPath: '/staff/login' })
    const path = ctx.resolve('byline/routes.ts')
    const source = `
      const admin = '/cms' as const
      export const routes = {
        api: '/rpc',
        admin,
        signIn: '/staff/login',
      } as const
      // user-owned
    `
    mkdirSync(ctx.resolve('byline'), { recursive: true })
    writeFileSync(path, source)

    const plan = buildRoutesPlan(ctx)
    expect(plan.writes.some((write) => write.path === path)).toBe(false)
    expect((await routesPhase.apply(plan, ctx)).state).toBe('done')
    expect(readFileSync(path, 'utf8')).toBe(source)
    expect(await routesPhase.detect(ctx)).toBe('done')
  })

  it('applies no route writes when aligned user config changes after preview', async () => {
    const ctx = fixture({ adminPath: '/cms' })
    const path = ctx.resolve('byline/routes.ts')
    mkdirSync(ctx.resolve('byline'), { recursive: true })
    writeFileSync(
      path,
      "export const routes = { admin: '/cms', api: '/rpc', signIn: '/sign-in' }\n"
    )
    const plan = buildRoutesPlan(ctx)
    writeFileSync(
      path,
      "export const routes = { admin: '/mine', api: '/rpc', signIn: '/sign-in' }\n"
    )

    expect((await routesPhase.apply(plan, ctx)).state).toBe('partial')
    expect(existsSync(ctx.resolve('src/routes/_byline/cms/route.tsx'))).toBe(false)
    expect(readFileSync(path, 'utf8')).toContain("admin: '/mine'")
  })

  it('preserves mismatched user-owned config and blocks every route write', async () => {
    const ctx = fixture({ adminPath: '/cms', signInPath: '/staff/login' })
    const path = ctx.resolve('byline/routes.ts')
    const source = "export const routes = { admin: '/mine', api: '/rpc', signIn: '/login' }\n"
    mkdirSync(ctx.resolve('byline'), { recursive: true })
    writeFileSync(path, source)

    const plan = buildRoutesPlan(ctx)
    expect(plan.writes).toEqual([])
    expect(plan.notes.join('\n')).toContain('user-owned routes.ts')
    expect((await routesPhase.apply(plan, ctx)).state).toBe('partial')
    expect(readFileSync(path, 'utf8')).toBe(source)
    expect(existsSync(ctx.resolve('src/routes/_byline/cms/route.tsx'))).toBe(false)
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
    expect((await routesPhase.apply(plan, ctx)).state).toBe('blocked')
    expect(readFileSync(path, 'utf8')).toContain('getMyRoutes')
  })

  it.each(['missing', 'corrupt', 'wrong-shape'])(
    'blocks all route writes when canonical routes template is %s',
    (state) => {
      const ctx = fixture({ adminPath: '/internal/cms' })
      const sourceTemplates = ctx.templatesDir()
      const copiedTemplates = ctx.resolve('test-templates')
      cpSync(sourceTemplates, copiedTemplates, { recursive: true })
      Object.defineProperty(ctx, 'templatesDir', { value: () => copiedTemplates })
      const canonical = `${copiedTemplates}/byline-examples/routes.ts`
      if (state === 'missing') rmSync(canonical)
      else if (state === 'corrupt')
        writeFileSync(canonical, "export const routes = { admin: '/admin'\n")
      else {
        writeFileSync(
          canonical,
          "export const routes = { admin: '/admin', api: '/api', signIn: '/sign-in' }\n"
        )
      }

      const plan = buildRoutesPlan(ctx)
      expect(plan.writes).toEqual([])
      expect(plan.notes.join('\n')).toContain('canonical routes.ts template')
    }
  )
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
