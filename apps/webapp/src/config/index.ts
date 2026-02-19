/**
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { base64Schema, urlSchema } from '@infonomic/schemas'
import { z } from 'zod/v4'

const schema = z.object({
  appVersion: z.string(),
  api: z.object({
    baseUrl: urlSchema,
    jwt: z.object({
      publicKey: base64Schema,
      issuer: z.string(),
      audience: z.string(),
    }),
  }),
})

type Config = z.infer<typeof schema>

const initConfig = (): Config =>
  schema.parse({
    appVersion: import.meta.env.VITE_APP_VERSION as string,
    api: {
      baseUrl: import.meta.env.VITE_API_BASE_URL as string,
      jwt: {
        publicKey: import.meta.env.VITE_API_JWT_PUBLIC_KEY as string,
        issuer: import.meta.env.VITE_API_JWT_ISSUER as string,
        audience: import.meta.env.VITE_API_JWT_AUDIENCE as string,
      },
    },
  })

let cachedConfig: Config

export const getConfig = (): Config => {
  if (cachedConfig == null) {
    cachedConfig = initConfig()
  }
  return cachedConfig
}
