/**
 * Single source of truth for the environment variables Byline expects in the
 * host application's `.env` / `.env.local`. Consumed by the `env` phase (to
 * render the files) and by `doctor` (to report which keys are missing).
 *
 * Each entry describes what the key is for and which file it belongs in
 * (per the TanStack Start / Vite convention — see
 * https://tanstack.com/start/latest/docs/framework/react/guide/environment-variables#environment-file-setup).
 * How its value is obtained (default, prompt, generated, computed from db
 * answers) is the env phase's concern — keep that logic in `phases/env.ts`,
 * not here.
 *
 * `file: 'public'` → `.env`, committed to git, no secrets.
 * `file: 'secret'` → `.env.local`, gitignored, secrets only.
 */

export type EnvKey =
  | 'VITE_SERVER_URL'
  | 'BYLINE_DB_POSTGRES_CONNECTION_STRING'
  | 'BYLINE_JWT_SECRET'
  | 'BYLINE_SUPERADMIN_EMAIL'
  | 'BYLINE_SUPERADMIN_PASSWORD'

export type EnvFile = 'public' | 'secret'

export interface EnvSpec {
  key: EnvKey
  description: string
  group: 'app' | 'database' | 'auth'
  file: EnvFile
}

export const ENV_SPECS: readonly EnvSpec[] = [
  {
    key: 'VITE_SERVER_URL',
    description: 'Public origin used by SSR and the admin UI',
    group: 'app',
    file: 'public',
  },
  {
    key: 'BYLINE_DB_POSTGRES_CONNECTION_STRING',
    description: 'Postgres connection string consumed by @byline/db-postgres',
    group: 'database',
    file: 'secret',
  },
  {
    key: 'BYLINE_JWT_SECRET',
    description: 'Signing secret for the built-in JwtSessionProvider (>= 32 bytes of entropy)',
    group: 'auth',
    file: 'secret',
  },
  {
    key: 'BYLINE_SUPERADMIN_EMAIL',
    description: 'Bootstrap super-admin email seeded by byline/seed.ts',
    group: 'auth',
    file: 'secret',
  },
  {
    key: 'BYLINE_SUPERADMIN_PASSWORD',
    description: 'Bootstrap super-admin password seeded by byline/seed.ts',
    group: 'auth',
    file: 'secret',
  },
] as const

export const ENV_KEYS: readonly EnvKey[] = ENV_SPECS.map((s) => s.key)

/**
 * Relative file paths (from the host app root) corresponding to each
 * `EnvFile` classification. Centralised here so the env phase and any
 * future tooling agree on where to read/write.
 */
export const ENV_FILE_PATHS: Record<EnvFile, string> = {
  public: '.env',
  secret: '.env.local',
}
