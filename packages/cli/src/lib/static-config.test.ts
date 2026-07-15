import { describe, expect, it } from 'vitest'

import { evaluateExportedConst, hasExportedCoreResolveRoutesCall } from './static-config.js'

describe('static config evaluation', () => {
  it('supports constants, spreads, parentheses, as const, and satisfies', () => {
    const result = evaluateExportedConst(
      `
        const admin = '/cms'
        const base = ({ admin, api: '/rpc' } as const)
        const signIn = '/staff/login' as const
        export const routes = ({ ...base, signIn } as const) satisfies Record<string, string>
      `,
      'routes'
    )

    expect(result).toEqual({
      ok: true,
      value: { admin: '/cms', api: '/rpc', signIn: '/staff/login' },
    })
  })

  it('recognizes only resolveRoutes imported from @byline/core', () => {
    expect(
      evaluateExportedConst(
        `
          import { resolveRoutes as resolve } from '@byline/core'
          const input = { admin: '/cms' } as const
          export const routes = resolve(input)
        `,
        'routes'
      )
    ).toEqual({
      ok: true,
      value: { admin: '/cms', api: '/api', signIn: '/sign-in' },
    })
    expect(
      evaluateExportedConst(
        `
          import { resolveRoutes } from './routes.js'
          export const routes = resolveRoutes({ admin: '/cms' })
        `,
        'routes'
      ).ok
    ).toBe(false)
  })

  it.each([
    ["import { value } from './config.js'; export const routes = value", 'imported'],
    ["const key = 'admin'; export const routes = { [key]: '/cms' }", 'computed'],
    ["let value = '/cms'; export const routes = { admin: value }", 'mutable'],
    ['const a = b; const b = a; export const routes = a', 'cyclic'],
    ['export const routes = process.env.ROUTES', 'property access'],
    ['export const routes = makeRoutes()', 'arbitrary call'],
  ])('rejects %s values', (source) => {
    expect(evaluateExportedConst(source, 'routes').ok).toBe(false)
  })

  it('does not execute source while parsing it', () => {
    const marker = '__bylineStaticParserExecuted'
    Reflect.deleteProperty(globalThis, marker)
    const result = evaluateExportedConst(
      `
        globalThis.${marker} = true
        export const routes = runUntrustedCode()
      `,
      'routes'
    )

    expect(result.ok).toBe(false)
    expect(Reflect.get(globalThis, marker)).toBeUndefined()
  })

  it.each([
    ["export const routes = { admin: '/cms'", 'parse diagnostics'],
    [
      "const base = { admin: '/cms' }; base.admin = '/evil'; export const routes = base",
      'assignment',
    ],
    [
      "const base = { admin: '/cms' }; Object.assign(base, { admin: '/evil' }); export const routes = base",
      'Object.assign',
    ],
    ['const base = { admin: 1 }; base.admin++; export const routes = base', 'increment'],
    ["const base = { admin: '/cms' }; mutate(base); export const routes = base", 'effectful call'],
    [
      "const base = { admin: '/cms' }; const alias = base; alias.admin = '/evil'; export const routes = base",
      'alias mutation',
    ],
    [
      "const base = { admin: '/cms' }; let alias; alias = base; alias.admin = '/evil'; export const routes = base",
      'assignment alias mutation',
    ],
    [
      "const base = { admin: '/cms' }; const holder = {}; holder.value = base; export const routes = base",
      'property escape',
    ],
  ])('rejects evaluated-binding mutation: %s', (source) => {
    expect(evaluateExportedConst(source, 'routes').ok).toBe(false)
  })

  it('does not confuse shadowed identifiers with evaluated bindings', () => {
    const result = evaluateExportedConst(
      `
        const admin = '/cms'
        function unrelated(admin: string) { console.log(admin) }
        export const routes = { admin }
      `,
      'routes'
    )

    expect(result).toEqual({ ok: true, value: { admin: '/cms' } })
  })

  it('rejects a malformed local declaration that collides with the core import', () => {
    const source = `
      import { resolveRoutes } from '@byline/core'
      const resolveRoutes = (value: unknown) => ({ admin: '/evil', value })
      export const routes = resolveRoutes({ admin: '/cms' })
    `

    expect(evaluateExportedConst(source, 'routes').ok).toBe(false)
    expect(hasExportedCoreResolveRoutesCall(source, 'routes')).toBe(false)
  })
})
