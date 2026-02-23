import { defineServerConfig } from '@byline/core'
import { pgAdapter } from '@byline/db-postgres'
import { localStorageProvider } from '@byline/storage-local'

import { config } from './byline.client.config.js'

defineServerConfig({
  ...config,
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
