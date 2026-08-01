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

import {
  DATABASE_ADAPTER_IDS,
  DATABASE_ADAPTERS,
  type DatabaseAdapterDefinition,
} from '../lib/database/adapters.js'
import { BYLINE_RELEASE_POLICY, CLI_PACKAGE_VERSION } from '../lib/release-policy.js'
import type { Answers, DatabaseAdapterId } from '../types.js'

export type DepGroup = 'byline' | 'runtime' | 'dev'

/**
 * Tag for opt-in deps. When set, the `deps` phase only installs the
 * package if `answers[optional] === true`. Keeps the user's project free
 * of dependencies they didn't ask for (e.g. the markdown ingestion stack
 * that exists only to serve `byline/scripts/import-docs.ts`).
 */
export type DepOptionalFlag = 'examples' | 'importDocs'

export interface DepSpec {
  name: string
  version: string
  group: DepGroup
  /** Short human-readable reason this is on the list. */
  note: string
  /** When set, only install if the matching `answers` flag is true. */
  optional?: DepOptionalFlag
  /** Database adapters for which this dependency is required. */
  adapters?: readonly DatabaseAdapterId[]
  /** Byline compatibility rule. Defaults to the supported release range. */
  versionPolicy?: 'supported-range' | 'exact'
}

// The templates and publishable packages release in lockstep with the CLI.
// Changesets updates package.json during version-packages; deriving this range
// makes that release version the sole source of truth for scaffolded installs.
export const BYLINE_VERSION = BYLINE_RELEASE_POLICY.dependencyRange
export const BYLINE_ADAPTER_VERSION = CLI_PACKAGE_VERSION

const DATABASE_DEP_SPECS: readonly DepSpec[] = DATABASE_ADAPTER_IDS.map((id) => ({
  name: DATABASE_ADAPTERS[id].packageName,
  version: BYLINE_ADAPTER_VERSION,
  group: 'byline',
  adapters: [id],
  versionPolicy: 'exact',
  note: `${DATABASE_ADAPTERS[id].label} adapter — pinned to the CLI's bundled schema baseline`,
}))

const SEARCH_DEP_SPECS: readonly DepSpec[] = DATABASE_ADAPTER_IDS.flatMap((id) => {
  const adapter: DatabaseAdapterDefinition = DATABASE_ADAPTERS[id]
  return adapter.searchPackageName
    ? [
        {
          name: adapter.searchPackageName,
          version: BYLINE_VERSION,
          group: 'byline',
          optional: 'examples',
          adapters: [id],
          note: `built-in ${adapter.label} full-text search provider used by example collections`,
        } satisfies DepSpec,
      ]
    : []
})

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
    name: '@byline/generated-types',
    version: BYLINE_VERSION,
    group: 'byline',
    note: 'declaration-merge target for the app-generated collection types',
  },
  ...DATABASE_DEP_SPECS,
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
  ...SEARCH_DEP_SPECS,
  {
    name: '@byline/storage-local',
    version: BYLINE_VERSION,
    group: 'byline',
    note: 'local-filesystem storage provider (default)',
  },
  {
    name: '@byline/storage-s3',
    version: BYLINE_VERSION,
    group: 'byline',
    note: 'S3 storage provider imported by the scaffolded server config',
  },
  {
    name: '@byline/ui',
    version: BYLINE_VERSION,
    group: 'byline',
    note: 'shared UI components used by admin route group',
  },

  // ---- Runtime third-party ------------------------------------------------
  {
    name: 'clsx',
    version: '^2.1.1',
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
    name: 'use-sync-external-store',
    version: '^1.6.0',
    group: 'runtime',
    note: "named in vite.config.ts's environments.client.optimizeDeps.include; it is otherwise only ever a transitive dependency (of @base-ui/react and @tanstack/react-store), and pnpm's strict layout leaves a transitive package unresolvable from the host app root — Vite then fails to pre-bundle it and the admin route never hydrates",
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
  {
    name: 'mdast-util-to-string',
    version: '^4.0.0',
    group: 'dev',
    optional: 'importDocs',
    note: 'extracts heading text in the optional markdown import helpers',
  },
] as const

export function dependencySpecsFor(answers: Answers): readonly DepSpec[] {
  const adapter = answers.dbAdapter
  if (!adapter) return []
  return DEP_SPECS.filter((spec) => {
    if (spec.adapters && !spec.adapters.includes(adapter)) return false
    if (spec.optional && answers[spec.optional] !== true) return false
    return true
  })
}
