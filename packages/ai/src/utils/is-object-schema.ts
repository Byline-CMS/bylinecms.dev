/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Credit: Adapted from https://github.com/ashbuilds/payload-ai
 * Portions copyright Ash Builds, licensed under MIT.
 */

/**
 * Type guard to check if a value is an object (likely a JSON schema object).
 * This is a simple structural check - it doesn't validate the full schema.
 */
export function isObjectSchema(schema: unknown): schema is Record<string, unknown> {
  return typeof schema === 'object' && schema !== null && !Array.isArray(schema)
}
