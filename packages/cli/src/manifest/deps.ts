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

/**
 * Tag for opt-in deps. When set, the `deps` phase only installs the
 * package if `answers[optional] === true`. Keeps the user's project free
 * of dependencies they didn't ask for (e.g. the markdown ingestion stack
 * that exists only to serve `byline/scripts/import-docs.ts`).
 */
export type DepOptionalFlag = 'importDocs'

export interface DepSpec {
  name: string
  version: string
  group: DepGroup
  /** Short human-readable reason this is on the list. */
  note: string
  /** When set, only install if the matching `answers` flag is true. */
  optional?: DepOptionalFlag
}

// Floor for installed `@byline/*` versions. The `@byline/*` packages release
// in lockstep, and the templates we drop into the host project reference
// 3.x-only APIs throughout (e.g. `i18n.translations` / `adminTranslations`,
// `source_locale`, the audit log, and `lexicalEditorToMarkdownServer`). A `^2`
// floor would let pnpm resolve the latest 2.x against these 3.x templates, so
// we floor at the current major. Bump the minor when a template starts using an
// API that landed in a later 3.x release.
export const BYLINE_VERSION = '^3.0.0'

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
    name: '@byline/i18n',
    version: BYLINE_VERSION,
    group: 'byline',
    note: 'admin-interface translations; imported by byline/i18n.ts (adminTranslations)',
  },
  {
    name: '@byline/richtext-lexical',
    version: BYLINE_VERSION,
    group: 'byline',
    note: 'Lexical-backed richtext field + server populate',
  },
  {
    name: '@byline/search-postgres',
    version: BYLINE_VERSION,
    group: 'byline',
    note: 'built-in Postgres full-text search provider; registered in byline/server.config.ts, drives collections/docs indexing hooks',
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

  // ---- Dev: optional, gated on `answers.importDocs` ---------------------
  // Markdown ingestion stack used only by the optional import-docs example
  // script. Skipped entirely when the user declines the import-docs prompt
  // in the `prompts` phase — the production app never imports them, and
  // they only matter when the developer runs `byline/scripts/import-docs.ts`.
  {
    name: 'gray-matter',
    version: '^4.0.3',
    group: 'dev',
    optional: 'importDocs',
    note: 'frontmatter parser used by byline/scripts/import-docs.ts',
  },
  {
    name: 'unified',
    version: '^11.0.5',
    group: 'dev',
    optional: 'importDocs',
    note: 'remark/mdast pipeline runner used by byline/scripts/import-docs.ts',
  },
  {
    name: 'remark-parse',
    version: '^11.0.0',
    group: 'dev',
    optional: 'importDocs',
    note: 'markdown → mdast parser used by byline/scripts/import-docs.ts',
  },
  {
    name: 'remark-gfm',
    version: '^4.0.1',
    group: 'dev',
    optional: 'importDocs',
    note: 'GitHub-Flavoured Markdown extensions for remark; used by byline/scripts/import-docs.ts',
  },
  {
    name: '@types/mdast',
    version: '^4.0.4',
    group: 'dev',
    optional: 'importDocs',
    note: 'TypeScript types for mdast nodes; consumed as type-only by byline/scripts/lib/mdast-to-lexical.ts',
  },
] as const
