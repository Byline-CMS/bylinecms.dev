/**
 * Single source of truth for the environment variables Byline expects in the
 * host application's `.env`. Consumed by the `env` phase (to render `.env`)
 * and by `doctor` (to report which keys are missing).
 *
 * Each entry describes what the key is for. How its value is obtained
 * (default, prompt, generated, computed from db answers) is the env phase's
 * concern — keep that logic in `phases/env.ts`, not here.
 */

export type EnvKey =
  | 'VITE_SERVER_URL'
  | 'DB_CONNECTION_STRING'
  | 'BYLINE_JWT_SECRET'
  | 'BYLINE_SUPERADMIN_EMAIL'
  | 'BYLINE_SUPERADMIN_PASSWORD'

export interface EnvSpec {
  key: EnvKey
  description: string
  group: 'app' | 'database' | 'auth'
}

export const ENV_SPECS: readonly EnvSpec[] = [
  {
    key: 'VITE_SERVER_URL',
    description: 'Public origin used by SSR and the admin UI',
    group: 'app',
  },
  {
    key: 'DB_CONNECTION_STRING',
    description: 'Postgres connection string consumed by @byline/db-postgres',
    group: 'database',
  },
  {
    key: 'BYLINE_JWT_SECRET',
    description: 'Signing secret for the built-in JwtSessionProvider (>= 32 bytes of entropy)',
    group: 'auth',
  },
  {
    key: 'BYLINE_SUPERADMIN_EMAIL',
    description: 'Bootstrap super-admin email seeded by byline/seed.ts',
    group: 'auth',
  },
  {
    key: 'BYLINE_SUPERADMIN_PASSWORD',
    description: 'Bootstrap super-admin password seeded by byline/seed.ts',
    group: 'auth',
  },
] as const

export const ENV_KEYS: readonly EnvKey[] = ENV_SPECS.map((s) => s.key)
