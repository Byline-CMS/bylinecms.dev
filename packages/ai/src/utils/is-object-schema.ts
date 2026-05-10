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
