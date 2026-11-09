import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'

import { afterEach, describe, expect, it } from 'vitest'

import { DATABASE_ADAPTER_IDS, databaseAdapterDefinition } from '../../lib/database/adapters.js'
import { createTestContext } from '../../test-helpers.js'
import { wirePhase } from './index.js'
import { wireViteConfig } from './vite-config.js'
import type { Context } from '../../context.js'
import type { Prompter } from '../../prompts.js'
import type { Logger } from '../../ui/logger.js'

const contexts: Context[] = []
afterEach(() => {
  for (const ctx of contexts.splice(0)) rmSync(ctx.cwd, { recursive: true, force: true })
})

function fixture(): Context {
  const ctx = createTestContext()
  contexts.push(ctx)
  return ctx
}

/** Backups are timestamped, so tests resolve them by prefix rather than name. */
function readBackup(ctx: Context): string {
  const backups = readdirSync(ctx.cwd).filter((name) => name.startsWith('vite.config.ts.bak-'))
  if (backups.length !== 1) throw new Error(`expected one backup, found ${backups.length}`)
  return readFileSync(ctx.resolve(backups[0] as string), 'utf8')
}

describe('Vite config safety', () => {
  it('surfaces a missing Vite config in the parent wire plan', async () => {
    const ctx = fixture()
    mkdirSync(ctx.resolve('src'), { recursive: true })
    writeFileSync(
      ctx.resolve('src/server.ts'),
      "import '../byline/server.config'\nconst serveUploads = true\n"
    )
    writeFileSync(ctx.resolve('src/start.ts'), 'const bylineCodedErrorAdapter = true\n')
    writeFileSync(
      ctx.resolve('tsconfig.json'),
      '{"compilerOptions":{"paths":{"~/*":["./byline/*"]}}}\n'
    )
    const plan = await wirePhase.plan(ctx)
    expect(plan.writes).toHaveLength(1)
    expect(plan.writes[0]?.path).toBe(ctx.resolve('vite.config.ts'))
  })

  it('previews and creates a missing canonical config', async () => {
    const ctx = fixture()
    const preview = await wireViteConfig.preview(ctx)
    expect(preview).toMatchObject({ status: 'done' })
    expect(preview.writes).toHaveLength(1)
    expect(await wireViteConfig.apply(ctx, preview.writes)).toMatchObject({ status: 'done' })
    expect(readFileSync(ctx.resolve('vite.config.ts'), 'utf8')).toBe(
      readFileSync(`${ctx.templatesDir()}/host/vite.config.ts`, 'utf8')
    )
    expect(readFileSync(ctx.resolve('vite.config.ts'), 'utf8')).toContain(
      'bylineClientHookBoundary()'
    )
    for (const adapter of DATABASE_ADAPTER_IDS) {
      expect(readFileSync(ctx.resolve('vite.config.ts'), 'utf8')).toContain(
        databaseAdapterDefinition(adapter).packageName
      )
    }
  })

  it('leaves a target changed after preview untouched', async () => {
    const ctx = fixture()
    const preview = await wireViteConfig.preview(ctx)
    const changed = 'export default { changedAfterPreview: true }\n'
    writeFileSync(ctx.resolve('vite.config.ts'), changed)
    expect(await wireViteConfig.apply(ctx, preview.writes)).toMatchObject({ status: 'manual' })
    expect(readFileSync(ctx.resolve('vite.config.ts'), 'utf8')).toBe(changed)
  })

  it('plans backup and replacement writes for a recognized canonical predecessor', async () => {
    const ctx = fixture()
    const canonical = readFileSync(`${ctx.templatesDir()}/host/vite.config.ts`, 'utf8')
    const predecessor = withoutMysqlExternalization(canonical)
      .replace("import { bylineClientHookBoundary } from '@byline/host-tanstack-start/vite'\n", '')
      .replace('    bylineClientHookBoundary(),\n', '')
      .replace(
        [
          '        //',
          '        // `use-sync-external-store/shim{,/with-selector}` are pinned explicitly',
          '        // too. Their named exports sit behind a `process.env.NODE_ENV`',
          '        // re-export; if Vite emits one as a standalone optimized chunk via the',
          '        // discovery path its interop only synthesises a default export, and a',
          '        // named `import { useSyncExternalStoreWithSelector }` (from',
          `        // @base-ui/utils' store) then throws "does not provide an export named …"`,
          '        // and the route never hydrates. Listing them as entries makes Vite walk',
          '        // the re-export and emit a proper named-export facade.',
          '',
        ].join('\n'),
        ''
      )
      .replace("          'use-sync-external-store/shim',\n", '')
      .replace("          'use-sync-external-store/shim/with-selector',\n", '')
    writeFileSync(ctx.resolve('vite.config.ts'), predecessor)

    const preview = await wireViteConfig.preview(ctx)
    expect(preview).toMatchObject({ status: 'done' })
    expect(preview.writes).toHaveLength(2)
    expect(preview.writes?.find((write) => write.path.endsWith('vite.config.ts'))?.before).toBe(
      predecessor
    )
    expect(await wireViteConfig.apply(ctx, preview.writes)).toMatchObject({ status: 'done' })
    expect(readBackup(ctx)).toBe(predecessor)
    expect(readFileSync(ctx.resolve('vite.config.ts'), 'utf8')).toBe(canonical)
  })

  it('replaces the canonical predecessor from before bylineNitroFeatures()', async () => {
    const ctx = fixture()
    const canonical = readFileSync(`${ctx.templatesDir()}/host/vite.config.ts`, 'utf8')
    const predecessor = withoutNitroFeatures(canonical)
    expect(predecessor).not.toContain('bylineNitroFeatures')
    writeFileSync(ctx.resolve('vite.config.ts'), predecessor)

    const preview = await wireViteConfig.preview(ctx)
    expect(preview.message).toContain('recognized canonical predecessor')
    expect(await wireViteConfig.apply(ctx, preview.writes)).toMatchObject({ status: 'done' })
    expect(readBackup(ctx)).toBe(predecessor)
    expect(readFileSync(ctx.resolve('vite.config.ts'), 'utf8')).toBe(canonical)
  })

  it('replaces the exact canonical predecessor from before MySQL externalization', async () => {
    const ctx = fixture()
    const canonical = readFileSync(`${ctx.templatesDir()}/host/vite.config.ts`, 'utf8')
    const predecessor = withoutMysqlExternalization(canonical)
    writeFileSync(ctx.resolve('vite.config.ts'), predecessor)

    const preview = await wireViteConfig.preview(ctx)
    expect(preview).toMatchObject({ status: 'done' })
    expect(preview.writes).toHaveLength(2)
    expect(await wireViteConfig.apply(ctx, preview.writes)).toMatchObject({ status: 'done' })
    expect(readBackup(ctx)).toBe(predecessor)
    expect(readFileSync(ctx.resolve('vite.config.ts'), 'utf8')).toBe(canonical)
  })

  it('replaces the canonical config that carried an app-owned build guard', async () => {
    const ctx = fixture()
    const canonical = readFileSync(`${ctx.templatesDir()}/host/vite.config.ts`, 'utf8')
    const predecessor = withoutMysqlExternalization(canonical)
      .replace("import { bylineClientHookBoundary } from '@byline/host-tanstack-start/vite'\n", '')
      .replace(
        "import { defineConfig, type Plugin } from 'vite'\n",
        "import { defineConfig, type Plugin } from 'vite'\n\nimport { clientHookBuildBoundary } from './byline/collections/client-hook-build-boundary.js'\n"
      )
      .replace('bylineClientHookBoundary()', 'clientHookBuildBoundary()')
    writeFileSync(ctx.resolve('vite.config.ts'), predecessor)

    const preview = await wireViteConfig.preview(ctx)
    expect(preview).toMatchObject({ status: 'done' })
    expect(await wireViteConfig.apply(ctx, preview.writes)).toMatchObject({ status: 'done' })
    expect(readBackup(ctx)).toBe(predecessor)
    expect(readFileSync(ctx.resolve('vite.config.ts'), 'utf8')).toBe(canonical)
  })

  it('merges Byline settings into a host config and backs up the original', async () => {
    // The ordinary first-install case: a stock TanStack Start app brings its own
    // vite.config.ts, matching neither the canonical config nor any predecessor
    // hash. Byline's settings are merged in rather than replacing the file.
    const ctx = fixture()
    const host = `import { defineConfig } from 'vite'
import { nitro } from 'nitro/vite'

const config = defineConfig({
  plugins: [nitro({ rollupConfig: { external: [/^@sentry\\//] } })],
})

export default config
`
    writeFileSync(ctx.resolve('vite.config.ts'), host)

    const preview = await wireViteConfig.preview(ctx)
    expect(preview).toMatchObject({ status: 'done' })
    expect(await wireViteConfig.apply(ctx, preview.writes)).toMatchObject({ status: 'done' })

    const merged = readFileSync(ctx.resolve('vite.config.ts'), 'utf8')
    expect(merged).toContain('noExternal: bylineSsrNoExternal')
    expect(merged).toContain('browserAsyncHooksAlias()')
    // The host's own nitro option must survive — it lives under `rollupConfig`,
    // a different key from the `rolldownConfig` Byline writes.
    expect(merged).toContain('@sentry')

    // The original is preserved under a timestamped name, so a later run cannot
    // collide with it the way the old fixed `vite.config.bak` did.
    const backups = readdirSync(ctx.cwd).filter((name) => name.startsWith('vite.config.ts.bak-'))
    expect(backups).toHaveLength(1)
    expect(readFileSync(ctx.resolve(backups[0] as string), 'utf8')).toBe(host)
  })

  it('blocks, without editing, on a config it cannot place settings into', async () => {
    // No inline `defineConfig({ ... })` to work with. This must block rather
    // than warn: `init` treats anything short of `blocked` as a soft warning and
    // would go on to report "installation complete" over an app that cannot boot.
    const ctx = fixture()
    const opaque = `import { defineConfig } from 'vite'
const options = { plugins: [] }
export default defineConfig(options)
`
    writeFileSync(ctx.resolve('vite.config.ts'), opaque)

    for (const result of [await wireViteConfig.preview(ctx), await wireViteConfig.apply(ctx)]) {
      expect(result).toMatchObject({ status: 'blocked' })
      // Blocking halts the run, so the snippet is the user's only instruction.
      expect(result.snippet).toBeTruthy()
      expect(result.message).toContain('byline init --from wire')
    }

    expect(readFileSync(ctx.resolve('vite.config.ts'), 'utf8')).toBe(opaque)
    expect(readdirSync(ctx.cwd).some((name) => name.startsWith('vite.config.ts.bak-'))).toBe(false)
  })
})

/**
 * Reconstructs the canonical config immediately before `@byline/i18n/react`
 * was pre-bundled — the newest entry in PREDECESSOR_HASHES.
 */
describe('customized Byline settings', () => {
  it('leaves a customized canonical config untouched and asks for a manual merge', async () => {
    const ctx = fixture()
    const canonical = readFileSync(`${ctx.templatesDir()}/host/vite.config.ts`, 'utf8')
    const anchor = "'react-dom',"
    const at = canonical.indexOf(anchor, canonical.indexOf('rolldownConfig')) + anchor.length
    const customized = `${canonical.slice(0, at)} 'host-native-dep',${canonical.slice(at)}`
    writeFileSync(ctx.resolve('vite.config.ts'), customized)

    const preview = await wireViteConfig.preview(ctx)
    expect(preview.status).toBe('manual')
    expect(preview.message).toContain('nitro `rolldownConfig` differs from every value')
    expect(preview.snippet).toBe(canonical)
    expect(preview.writes ?? []).toEqual([])

    expect(await wireViteConfig.apply(ctx, preview.writes)).toMatchObject({ status: 'manual' })
    expect(readFileSync(ctx.resolve('vite.config.ts'), 'utf8')).toBe(customized)
    expect(readdirSync(ctx.cwd).some((name) => name.startsWith('vite.config.ts.bak-'))).toBe(false)
  })

  it('applies safe changes but stays manual while customized settings remain', async () => {
    // A customized rolldownConfig next to a missing `features`: Byline can add
    // `features`, but the rolldownConfig still needs a hand merge. Applying the
    // safe part must not report the config as complete.
    const ctx = fixture()
    const canonical = readFileSync(`${ctx.templatesDir()}/host/vite.config.ts`, 'utf8')
    const anchor = "'react-dom',"
    const at = canonical.indexOf(anchor, canonical.indexOf('rolldownConfig')) + anchor.length
    const mixed = `${canonical.slice(0, at)} 'host-native-dep',${canonical.slice(at)}`.replace(
      /\n {6}\/\/ Nitro 3 release candidates swap in[\s\S]*?features: bylineNitroFeatures\(\),/,
      ''
    )
    expect(mixed).not.toContain('features:')
    writeFileSync(ctx.resolve('vite.config.ts'), mixed)

    const preview = await wireViteConfig.preview(ctx)
    expect(preview.status).toBe('manual')
    expect(preview.message).toContain('set nitro features')
    expect(preview.message).toContain('nitro `rolldownConfig` differs from every value')
    expect(preview.snippet).toBe(canonical)
    expect(preview.writes).toHaveLength(2)

    const applied = await wireViteConfig.apply(ctx, preview.writes)
    expect(applied.status).toBe('manual')
    expect(applied.message).toContain('backup: vite.config.ts.bak-')
    expect(applied.message).toContain('nitro `rolldownConfig` differs from every value')
    expect(applied.message).toContain('byline init --from wire')
    expect(applied.snippet).toBe(canonical)

    const updated = readFileSync(ctx.resolve('vite.config.ts'), 'utf8')
    expect(updated).toContain('features: bylineNitroFeatures()')
    expect(updated).toContain('host-native-dep')
    expect(readBackup(ctx)).toBe(mixed)
    // Re-inspecting agrees with what apply reported.
    expect((await wireViteConfig.preview(ctx)).status).toBe('manual')
  })

  for (const [label, customized, expected] of [
    ['partial while a customized setting remains', true, 'partial'],
    ['done once every setting is merged', false, 'done'],
  ] as const) {
    it(`reports ${label} from the wire phase`, async () => {
      const ctx = fixture()
      mkdirSync(ctx.resolve('src'), { recursive: true })
      writeFileSync(
        ctx.resolve('src/server.ts'),
        "import '../byline/server.config'\nconst serveUploads = true\n"
      )
      // A real Start entry, so the start-ts sub-edit can finish and only the
      // Vite config decides the phase result.
      writeFileSync(
        ctx.resolve('src/start.ts'),
        "import { createStart } from '@tanstack/react-start'\n" +
          "import { bylineCodedErrorAdapter } from '@byline/host-tanstack-start/integrations/start-errors'\n" +
          'export const startInstance = createStart(() => ({ serializationAdapters: [bylineCodedErrorAdapter] }))\n'
      )
      writeFileSync(
        ctx.resolve('tsconfig.json'),
        '{"compilerOptions":{"paths":{"~/*":["./byline/*"]}}}\n'
      )
      const canonical = readFileSync(`${ctx.templatesDir()}/host/vite.config.ts`, 'utf8')
      const anchor = "'react-dom',"
      const at = canonical.indexOf(anchor, canonical.indexOf('rolldownConfig')) + anchor.length
      const base = customized
        ? `${canonical.slice(0, at)} 'host-native-dep',${canonical.slice(at)}`
        : canonical
      writeFileSync(
        ctx.resolve('vite.config.ts'),
        base.replace(
          /\n {6}\/\/ Nitro 3 release candidates swap in[\s\S]*?features: bylineNitroFeatures\(\),/,
          ''
        )
      )

      const plan = await wirePhase.plan(ctx)
      expect((await wirePhase.apply(plan, ctx)).state).toBe(expected)
    })
  }

  it("reports a blocked sub-edit's reason and snippet from detect", async () => {
    // The runner stops on a blocked detect without planning, so detect itself
    // must print why, or the user sees only "wire — blocked; cannot proceed".
    const errors: string[] = []
    const notes: string[] = []
    const base = fixture()
    const logger: Logger = { ...base.logger, error: (message) => errors.push(message) }
    const prompter: Prompter = {
      ...base.prompter,
      note: (message, title) => notes.push(`${title}\n${message}`),
    }
    const ctx = createTestContext({}, { logger, prompter })
    contexts.push(ctx)
    writeFileSync(
      ctx.resolve('vite.config.ts'),
      "import { defineConfig } from 'vite'\nconst options = { plugins: [] }\nexport default defineConfig(options)\n"
    )

    expect(await wirePhase.detect(ctx)).toBe('blocked')
    expect(
      errors.some((line) => line.includes('vite-config:') && line.includes('left untouched'))
    ).toBe(true)
    expect(notes.some((note) => note.startsWith('vite-config: required configuration'))).toBe(true)
  })
})

/** The canonical config before `bylineNitroFeatures()` disabled srvx FastResponse. */
function withoutNitroFeatures(canonical: string): string {
  return canonical
    .replace(
      "import { bylineClientHookBoundary, bylineNitroFeatures } from '@byline/host-tanstack-start/vite'",
      "import { bylineClientHookBoundary } from '@byline/host-tanstack-start/vite'"
    )
    .replace(
      /\n {6}\/\/ Nitro 3 release candidates swap in[\s\S]*?features: bylineNitroFeatures\(\),/,
      ''
    )
}

function withoutI18nPreBundling(canonical: string): string {
  return withoutNitroFeatures(canonical).replace(
    `        // \`@byline/i18n/react\` is pinned for a different reason from the rest:
        // module identity, not interop. The admin layout mounts
        // \`<I18nProvider>\` from \`@byline/host-tanstack-start\`, which is
        // deliberately NOT pre-bundled (see the note below), while collection
        // views reach \`useTranslation\` through \`@byline/admin\` and
        // \`@byline/richtext-lexical\`, which are. Left undeclared, the optimizer
        // inlines a copy of the module into the chunk that reaches it first and
        // the host adapter loads a second copy through the regular pipeline —
        // two React Contexts, so the provider is invisible to the consumer and
        // every collection route throws "useTranslation must be used inside
        // <I18nProvider>". Naming it as an entry makes every importer, pipeline
        // or pre-bundled, resolve to one module instance.
        include: [
          '@byline/ui/react',
          '@byline/i18n/react',
`,
    "        include: [\n          '@byline/ui/react',\n"
  )
}

function withoutMysqlExternalization(canonical: string): string {
  return withoutI18nPreBundling(canonical)
    .replace(
      '// database / storage adapters through composition at runtime, not',
      '// db-postgres / storage adapters through composition at runtime, not'
    )
    .replace(
      '//   - @byline/db-postgres + @byline/db-mysql — database drivers',
      '//   - @byline/db-postgres — depends on `pg` native bindings'
    )
    .replace("  '@byline/db-mysql',\n", '')
    .replace(
      '/^@byline\\/(db-postgres|db-mysql|storage-local|storage-s3)/',
      '/^@byline\\/(db-postgres|storage-local|storage-s3)/'
    )
}
