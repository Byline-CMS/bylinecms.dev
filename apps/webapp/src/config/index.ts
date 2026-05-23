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
})

export type ServerConfig = z.infer<typeof serverSchema>

const initServerConfig = (): ServerConfig =>
  serverSchema.parse({
    port: process.env.PORT,
    // VITE_* keys are read via `import.meta.env` so the value comes purely
    // from `.env` / `.env.production` at build time — same source as the
    // public config and the client bundle. fly.toml `[env]` only sets
    // `process.env`, which doesn't drive Vite's static replacement, so
    // reading via `import.meta.env` here removes a class of drift bugs
    // where build-time and runtime values disagree.
    siteName: import.meta.env.VITE_SITE_NAME,
    siteDescription: import.meta.env.VITE_SITE_DESCRIPTION,
    serverUrl: import.meta.env.VITE_SERVER_URL,
  })

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
