/**
 * Single source of truth for the npm packages a Byline-on-TanStack-Start
 * install needs in the host application's `package.json`. Consumed by the
 * `deps` phase (to install missing entries) and by `doctor` (to report
 * what's missing without re-running the install).
 *
 * Versioning policy: `@byline/*` packages are released in lockstep, so
 * they share `BYLINE_VERSION`. `@byline/host-tanstack-start` rides its
 * own `1.x` line because its API surface (route stubs, integrations) is
 * stable across Byline minor bumps and consumers pin against it
 * separately.
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

export const BYLINE_VERSION = '^0.10.0'
export const HOST_TANSTACK_VERSION = '^1.0.0'

export const DEP_SPECS: readonly DepSpec[] = [
  // ---- @byline/* — released in lockstep at BYLINE_VERSION -----------------
  {
    name: '@byline/admin',
    version: BYLINE_VERSION,
    group: 'byline',
    note: 'admin user / role / permission modules + JwtSessionProvider',
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
    version: HOST_TANSTACK_VERSION,
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
    name: 'dotenv',
    version: '^17.4.2',
    group: 'runtime',
    note: 'used by byline/seed',
  },
  {
    name: 'lodash-es',
    version: '^4.17.21',
    group: 'runtime',
    note: 'used by byline/ config helpers',
  },
  {
    name: 'pino',
    version: '^10.3.1',
    group: 'runtime',
    note: 'logger imported directly by @byline/core; Nitro tracer needs it owned at the app boundary',
  },
  {
    name: 'nitro',
    version: 'npm:nitro-nightly@latest',
    group: 'runtime',
    note: 'Nitro plugin that drives TanStack Start SSR builds (vite.config.ts plugin)',
  },

  // ---- Dev ---------------------------------------------------------------
  {
    name: '@tanstack/devtools-vite',
    version: '^0.6.0',
    group: 'dev',
    note: 'TanStack devtools Vite plugin (used by canonical vite.config.ts)',
  },
  {
    name: '@types/lodash-es',
    version: '^4.17.12',
    group: 'dev',
    note: 'types for lodash-es',
  },
  {
    name: 'tsx',
    version: '^4.21.0',
    group: 'dev',
    note: 'runs byline/seed.ts and byline/scripts/* without a build step',
  },
] as const
