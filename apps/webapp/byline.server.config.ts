import { defineServerConfig } from '@byline/core'
import { pgAdapter } from '@byline/db-postgres'
import { localStorageProvider } from '@byline/storage-local'

import { config } from './byline.client.config.js'

defineServerConfig({
  ...config,
  db: pgAdapter({
    connectionString: process.env.DB_CONNECTION_STRING || '',
  }),
  // Local filesystem storage provider — suitable for development and
  // self-hosted deployments. Swap for '@byline/storage-s3' (s3StorageProvider)
  // for cloud/production environments.
  //
  // The `uploadDir` is relative to the project root. Ensure the directory is
  // served as a static path at `baseUrl` by your web server / CDN.
  storage: localStorageProvider({
    uploadDir: './public/uploads',
    baseUrl: '/uploads',
  }),
})
