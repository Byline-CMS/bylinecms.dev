import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/database/schema/index.ts',
  out: './src/database/migrations',
  // migrations: {
  //   prefix: 'modulus',
  // },
  dbCredentials: {
    // @ts-expect-error
    url: process.env.BYLINE_DB_POSTGRES_CONNECTION_STRING as string,
  },
  verbose: true,
  strict: true,
})
