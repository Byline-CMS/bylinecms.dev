/**
 * Byline CMS
 *
 * Copyright © 2025 Anthony Bouch and contributors.
 *
 * This file is part of Byline CMS.
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as
 * published by the Free Software Foundation, either version 3 of the
 * License, or (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program. If not, see <https://www.gnu.org/licenses/>.
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
