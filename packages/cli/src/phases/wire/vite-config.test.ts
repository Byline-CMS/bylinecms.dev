import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'

import { afterEach, describe, expect, it } from 'vitest'

import { createTestContext } from '../../test-helpers.js'
import { wirePhase } from './index.js'
import { wireViteConfig } from './vite-config.js'
import type { Context } from '../../context.js'

const contexts: Context[] = []
afterEach(() => {
  for (const ctx of contexts.splice(0)) rmSync(ctx.cwd, { recursive: true, force: true })
})

function fixture(): Context {
  const ctx = createTestContext()
  contexts.push(ctx)
  return ctx
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
    const predecessor = canonical
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
    expect(readFileSync(ctx.resolve('vite.config.bak'), 'utf8')).toBe(predecessor)
    expect(readFileSync(ctx.resolve('vite.config.ts'), 'utf8')).toBe(canonical)
  })

  it('replaces the canonical config that carried an app-owned build guard', async () => {
    const ctx = fixture()
    const canonical = readFileSync(`${ctx.templatesDir()}/host/vite.config.ts`, 'utf8')
    const predecessor = canonical
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
    expect(readFileSync(ctx.resolve('vite.config.bak'), 'utf8')).toBe(predecessor)
    expect(readFileSync(ctx.resolve('vite.config.ts'), 'utf8')).toBe(canonical)
  })

  it('keeps a divergent user config manual in both preview and apply', async () => {
    const ctx = fixture()
    const custom =
      "import { defineConfig } from 'vite'\nexport default defineConfig({ custom: true })\n"
    writeFileSync(ctx.resolve('vite.config.ts'), custom)
    expect(await wireViteConfig.preview(ctx)).toMatchObject({ status: 'manual' })
    expect(await wireViteConfig.apply(ctx)).toMatchObject({ status: 'manual' })
    expect(readFileSync(ctx.resolve('vite.config.ts'), 'utf8')).toBe(custom)
    expect(existsSync(ctx.resolve('vite.config.bak'))).toBe(false)
  })
})
