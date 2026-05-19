/**
 * Single source of truth for the npm packages a Byline-on-TanStack-Start
 * install needs in the host application's `package.json`. Consumed by the
 * `deps` phase (to install missing entries) and by `doctor` (to report
 * what's missing without re-running the install).
 *
 * Versioning policy: all publishable `@byline/*` packages are released
 * in lockstep, so they share `BYLINE_VERSION` — including
 * `@byline/host-tanstack-start`, which previously rode its own `1.x`
 * line but is now part of the lockstep set from 2.x onwards.
 *
 * Scope: this list is intentionally minimal — only packages that are
 * directly imported by files we drop into the user's tree (`byline/`,
 * `src/routes/_byline/`, `src/ui/byline/`). Transitive deps reach the
 * user via the `@byline/*` package boundary and don't need declaring.
 */

export type DepGroup = 'byline' | 'runtime' | 'dev'

export interface DepSpec {
  name: string
  version: string
  group: DepGroup
  /** Short human-readable reason this is on the list. */
  note: string
}

export const BYLINE_VERSION = '^2.0.0'

export const DEP_SPECS: readonly DepSpec[] = [
  // ---- @byline/* — released in lockstep at BYLINE_VERSION -----------------
  {
    name: '@byline/admin',
    version: BYLINE_VERSION,
    group: 'byline',
    note: 'admin user / role / permission modules + JwtSessionProvider',
  },
  {
    name: '@byline/ai',
    version: BYLINE_VERSION,
    group: 'byline',
    note: 'AI subsystem; pre-bundled by the host vite.config.ts via optimizeDeps.include',
  },
  {
    name: '@byline/auth',
    version: BYLINE_VERSION,
    group: 'byline',
    note: 'actor primitives, RequestContext, AbilityRegistry',
  },
  {
    name: '@byline/client',
    version: BYLINE_VERSION,
    group: 'byline',
    note: 'in-process SDK over storage primitives + document lifecycle',
  },
  {
    name: '@byline/core',
    version: BYLINE_VERSION,
    group: 'byline',
    note: 'types, config, patches, workflow, Zod schema builder',
  },
  {
    name: '@byline/db-postgres',
    version: BYLINE_VERSION,
    group: 'byline',
    note: 'Postgres adapter (Drizzle ORM)',
  },
  {
    name: '@byline/host-tanstack-start',
    version: BYLINE_VERSION,
    group: 'byline',
    note: 'TanStack Start integrations + route stubs',
  },
  {
    name: '@byline/richtext-lexical',
    version: BYLINE_VERSION,
    group: 'byline',
    note: 'Lexical-backed richtext field + server populate',
  },
  {
    name: '@byline/storage-local',
    version: BYLINE_VERSION,
    group: 'byline',
    note: 'local-filesystem storage provider (default)',
  },
  {
    name: '@byline/ui',
    version: BYLINE_VERSION,
    group: 'byline',
    note: 'shared UI components used by admin route group',
  },

  // ---- Runtime third-party ------------------------------------------------
  {
    name: 'classnames',
    version: '^2.5.1',
    group: 'runtime',
    note: 'utility for conditionally joining classNames; imported by ui/byline templates',
  },
  {
    name: 'dotenv',
    version: '^17.4.2',
    group: 'runtime',
    note: 'used by byline/seed',
  },
  {
    name: 'pino',
    version: '^10.3.1',
    group: 'runtime',
    note: 'logger imported directly by @byline/core; Nitro tracer needs it owned at the app boundary',
  },
  {
    name: 'prism-react-renderer',
    version: '^2.4.1',
    group: 'runtime',
    note: 'code-block syntax highlighting; imported by src/ui/byline/components/code/code.tsx',
  },
  {
    name: 'sharp',
    version: '^0.34.5',
    group: 'runtime',
    note: 'native libvips binding imported by @byline/core/image; externalised at the SSR boundary so pnpm must symlink it into the host app',
  },
  {
    name: 'nitro',
    version: 'npm:nitro-nightly@latest',
    group: 'runtime',
    note: 'Nitro plugin that drives TanStack Start SSR builds (vite.config.ts plugin); matches the spec TanStack Start scaffolds, so this is a no-op for users coming via `npx @tanstack/cli create`',
  },

  // ---- Dev ---------------------------------------------------------------
  {
    name: '@tanstack/devtools-vite',
    version: '^0.6.0',
    group: 'dev',
    note: 'TanStack devtools Vite plugin (used by canonical vite.config.ts)',
  },
  {
    name: 'tsx',
    version: '^4.21.0',
    group: 'dev',
    note: 'runs byline/seed.ts and byline/scripts/* without a build step',
  },

  // ---- Dev: required by byline/scripts/import-docs.ts --------------------
  // Markdown ingestion stack used only by the optional import-docs example
  // script. Kept in `dev` because the production app never imports them —
  // they only matter when the developer runs `tsx byline/scripts/import-docs.ts`.
  {
    name: 'gray-matter',
    version: '^4.0.3',
    group: 'dev',
    note: 'frontmatter parser used by byline/scripts/import-docs.ts',
  },
  {
    name: 'unified',
    version: '^11.0.5',
    group: 'dev',
    note: 'remark/mdast pipeline runner used by byline/scripts/import-docs.ts',
  },
  {
    name: 'remark-parse',
    version: '^11.0.0',
    group: 'dev',
    note: 'markdown → mdast parser used by byline/scripts/import-docs.ts',
  },
  {
    name: 'remark-gfm',
    version: '^4.0.1',
    group: 'dev',
    note: 'GitHub-Flavoured Markdown extensions for remark; used by byline/scripts/import-docs.ts',
  },
  {
    name: '@types/mdast',
    version: '^4.0.4',
    group: 'dev',
    note: 'TypeScript types for mdast nodes; consumed as type-only by byline/scripts/lib/mdast-to-lexical.ts',
  },
] as const
