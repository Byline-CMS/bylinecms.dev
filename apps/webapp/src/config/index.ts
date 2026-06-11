import { booleanSchema, urlSchema } from '@infonomic/schemas'
import { z } from 'zod'

/**
 * Server configuration. Read at runtime from `process.env` on the server
 * only — secrets (`.env.local`) and non-`VITE_` keys are never shipped to
 * the client. Values that are conceptually shared with the public config
 * (site name, base URL, etc.) are read from the same `VITE_*` keys as
 * `getPublicConfig()` so there is a single source of truth in `.env` /
 * `.env.local`. Nitro loads both files into `process.env` at runtime, so
 * the `VITE_*` keys are visible here even though their primary purpose is
 * build-time inlining into the client bundle.
 */
const serverSchema = z.object({
  port: z.coerce.number().int(),
  siteName: z.string(),
  siteDescription: z.string(),
  serverUrl: urlSchema,
  log: z.object({
    level: z.string().optional(),
    pretty: booleanSchema(),
  }),
  /**
   * Optional L1 in-memory data cache (see docs/DATA-CACHE-DESIGN.md). All
   * server-only — read from `process.env`, never shipped to the client.
   * Defaults keep the cache and the cluster fan-out OFF unless explicitly
   * enabled, so adopters opt in deliberately.
   */
  cache: z
    .object({
      /** Master switch for the L1 data cache. */
      dataRequests: booleanSchema(),
      /**
       * Default per-entry TTL (ms) for cached reads. Per-call sites may
       * override (e.g. sitemaps use a longer TTL). Keep in step with
       * `DEFAULT_TTL_MS` in `src/lib/cache/cache-manager.ts`.
       */
      ttl: z.coerce.number().int().positive().default(60_000),
      /**
       * In-memory SWR trigger, expressed as ms of *remaining* TTL. When an
       * entry's remaining TTL drops below this, the next read returns the
       * stale value immediately and refreshes it in the background. Must be
       * less than `ttl`. Unset ⇒ no SWR (a plain synchronous miss on expiry).
       */
      refreshThreshold: z.coerce.number().int().positive().optional(),
      /**
       * Fly.io (or any multi-instance) cross-instance invalidation fan-out.
       * Off by default — a single origin behind a CDN never needs it. Only
       * read by `invalidateTag` / `invalidateKey` when `true`.
       */
      clusterEnabled: booleanSchema(),
      /** Fly private (6PN) DNS name used to enumerate sibling instances. */
      privateNetworkDomain: z.string().optional(),
      /** Port the sibling cache-invalidation endpoint listens on. */
      privateNetworkApplicationPort: z.coerce.number().int().optional(),
    })
    .refine((c) => c.refreshThreshold == null || c.refreshThreshold < c.ttl, {
      message: 'cache.refreshThreshold must be less than cache.ttl',
      path: ['refreshThreshold'],
    }),
})

export type ServerConfig = z.infer<typeof serverSchema>

const initServerConfig = (): ServerConfig => {
  // VITE_* keys are read via `import.meta.env` so the value comes purely
  // from `.env` / `.env.production` at build time — same source as the
  // public config and the client bundle. fly.toml `[env]` only sets
  // `process.env`, which doesn't drive Vite's static replacement, so
  // reading via `import.meta.env` here removes a class of drift bugs
  // where build-time and runtime values disagree.
  //
  // When this server-only module is loaded by a plain `tsx` script (seeds,
  // import-docs, re-anchor, …) there is no Vite, so `import.meta.env` is
  // `undefined` — fall back to `process.env`, which `byline/load-env.ts`
  // has already populated from `.env` / `.env.local`. (The *public* config
  // below must keep the literal `import.meta.env.VITE_*` expressions: it
  // runs in the client bundle, where only the exact expression is
  // statically replaced.)
  const viteEnv: Record<string, string | undefined> =
    (import.meta as { env?: Record<string, string | undefined> }).env ??
    (process.env as Record<string, string | undefined>)

  return serverSchema.parse({
    // Vite's dev server owns the port in development (`--port 5173`), so
    // PORT is only set in production (see the `start` script).
    port: process.env.PORT ?? 5173,
    log: {
      level: process.env.LOG_LEVEL ?? 'info',
      pretty: process.env.LOG_PRETTY ?? 'false',
    },
    siteName: viteEnv.VITE_SITE_NAME,
    siteDescription: viteEnv.VITE_SITE_DESCRIPTION,
    serverUrl: viteEnv.VITE_SERVER_URL,
    cache: {
      // Default OFF: unset env ⇒ cache disabled, behaviour identical to today.
      dataRequests: process.env.CACHING_DATA_REQUESTS ?? 'false',
      // Unset ⇒ schema defaults (ttl 60s, no SWR).
      ttl: process.env.CACHING_TTL,
      refreshThreshold: process.env.CACHING_REFRESH_THRESHOLD,
      clusterEnabled: process.env.CACHING_CLUSTER_ENABLED ?? 'false',
      privateNetworkDomain: process.env.PRIVATE_NETWORK_DOMAIN,
      privateNetworkApplicationPort: process.env.PRIVATE_NETWORK_APPLICATION_PORT,
    },
  })
}

let cachedServerConfig: ServerConfig

export const getServerConfig = (): ServerConfig => {
  if (cachedServerConfig == null) {
    cachedServerConfig = initServerConfig()
  }
  return cachedServerConfig
}

/**
 * "Public" configuration. Originally split out under Next.js, where
 * `NEXT_PUBLIC_*` vars were inlined into the client bundle. Under
 * TanStack Start / Vite, the equivalent mechanism is `import.meta.env.VITE_*`
 * — Vite statically replaces these references at build time in both the
 * server and client bundles. This matters for any code path that runs in
 * both phases — notably TanStack Router's `head()`, which executes during
 * SSR *and* again on the client during hydration / route changes. Reading
 * `process.env` here would parse to `undefined` in the browser bundle and
 * throw a ZodError on hydrate.
 */
const publicSchema = z.object({
  siteName: z.string(),
  siteDescription: z.string(),
  serverUrl: urlSchema,
})

export type PublicConfig = z.infer<typeof publicSchema>

const initPublicConfig = (): PublicConfig =>
  publicSchema.parse({
    siteName: import.meta.env.VITE_SITE_NAME,
    siteDescription: import.meta.env.VITE_SITE_DESCRIPTION,
    serverUrl: import.meta.env.VITE_SERVER_URL,
  })

let cachedPublicConfig: PublicConfig

export const getPublicConfig = (): PublicConfig => {
  if (cachedPublicConfig == null) {
    cachedPublicConfig = initPublicConfig()
  }
  return cachedPublicConfig
}
