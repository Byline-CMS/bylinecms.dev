import { defineServerConfig } from '@byline/core'
import { pgAdapter } from '@byline/db-postgres'

import { config } from './byline.client.config.js'

defineServerConfig({
  ...config,
  db: pgAdapter({
    connectionString: process.env.DB_CONNECTION_STRING || '',
  }),
})
