import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  dialect: 'mysql',
  schema: './src/database/schema/index.ts',
  out: './src/database/migrations',
  dbCredentials: {
    // @ts-expect-error
    url: process.env.BYLINE_DB_MYSQL_CONNECTION_STRING as string,
  },
  verbose: true,
  strict: true,
})
