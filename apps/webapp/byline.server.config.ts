import { defineServerConfig } from '@byline/core'
import { pgAdapter } from '@byline/db-postgres'
import { localStorageProvider } from '@byline/storage-local'

// Import collection definitions directly from schema files — NOT the full
// client config or index barrels. The client config / index files pull in
// admin configs (React components, CSS modules) that are not loadable
// outside Vite (e.g. when running seeds via tsx).
import { Docs } from './byline/collections/docs/schema.js'
import { Media } from './byline/collections/media/schema.js'
import { News } from './byline/collections/news/schema.js'
import { Pages } from './byline/collections/pages/schema.js'

defineServerConfig({
  serverURL: 'http://localhost:5173/',
  i18n: {
    interface: {
      defaultLocale: 'en',
      locales: ['en', 'es'],
    },
    content: {
      defaultLocale: 'en',
      locales: ['en', 'es'],
    },
  },
  collections: [Docs, News, Pages, Media],
  db: pgAdapter({
    connectionString: process.env.DB_CONNECTION_STRING || '',
  }),
  // Site-wide default storage provider — used by any upload collection that
  // does not specify its own `upload.storage` override.
  //
  // To route a specific collection to a different backend, set `storage`
  // inside that collection's `upload` config block instead of (or in addition
  // to) this site-wide default.
  //
  // Local filesystem is suitable for development and self-hosted deployments.
  // Swap for '@byline/storage-s3' (s3StorageProvider) for cloud/production.
  // The `uploadDir` is served as a static path at `baseUrl` by your web server.
  storage: localStorageProvider({
    uploadDir: './public/uploads',
    baseUrl: '/uploads',
  }),
})
