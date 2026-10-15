import type { PasskeyProvider, SessionProvider } from '@byline/auth'

import type { PasskeyConfig } from '../@types/site-config.js'

const methods = [
  'signInOptions',
  'verifySignIn',
  'passwordProof',
  'proofOptions',
  'verifyProof',
  'enrollmentOptions',
  'verifyEnrollment',
  'listCredentials',
  'renameCredential',
  'removeCredential',
] as const satisfies readonly (keyof PasskeyProvider)[]

function invalid(reason: string): never {
  throw new Error(`Invalid passkey configuration: ${reason}`)
}

/** Pure boot-time validation; deliberately contains no Node or cryptographic imports. */
export function resolvePasskeyConfig(
  config: PasskeyConfig | undefined,
  provider: Pick<SessionProvider, 'capabilities' | 'passkeys'> | undefined
): PasskeyConfig | undefined {
  const supported = provider?.capabilities.passkeys
  if (supported !== undefined && typeof supported !== 'boolean') {
    invalid('provider capability must be a boolean')
  }
  if (config === undefined) {
    if (supported === true || provider?.passkeys !== undefined) {
      invalid('an enabled provider requires explicit relying-party configuration')
    }
    return undefined
  }
  if (!config || typeof config !== 'object' || Array.isArray(config)) invalid('expected an object')
  if (supported !== true || !provider?.passkeys) invalid('provider does not support passkeys')
  for (const method of methods) {
    if (typeof provider.passkeys[method] !== 'function') invalid(`provider is missing ${method}`)
  }
  const allowed = new Set(['rpId', 'rpName', 'origins', 'allowInsecureLocalhost'])
  if (Object.keys(config).some((key) => !allowed.has(key))) invalid('unknown configuration option')
  if (
    typeof config.rpId !== 'string' ||
    config.rpId.length > 253 ||
    !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(
      config.rpId
    ) ||
    (config.rpId !== 'localhost' && !config.rpId.includes('.')) ||
    /^[\d.]+$/.test(config.rpId)
  ) {
    invalid('rpId must be a canonical DNS name or localhost')
  }
  if (typeof config.rpName !== 'string' || !config.rpName.trim() || config.rpName.length > 200) {
    invalid('rpName must contain 1–200 characters')
  }
  if (
    config.allowInsecureLocalhost !== undefined &&
    typeof config.allowInsecureLocalhost !== 'boolean'
  ) {
    invalid('allowInsecureLocalhost must be a boolean')
  }
  if (!Array.isArray(config.origins) || config.origins.length === 0) invalid('origins are required')
  const origins: string[] = []
  for (const origin of config.origins) {
    if (typeof origin !== 'string') invalid('origins must be strings')
    let url: URL
    try {
      url = new URL(origin)
    } catch {
      invalid('origin is not a URL')
    }
    if (url.origin !== origin || url.username || url.password)
      invalid('origins must be exact origins')
    const local =
      config.allowInsecureLocalhost === true &&
      config.rpId === 'localhost' &&
      url.hostname === 'localhost' &&
      url.protocol === 'http:'
    if (url.protocol !== 'https:' && !local)
      invalid('origins require HTTPS outside explicit localhost development')
    if (url.hostname !== config.rpId && !url.hostname.endsWith(`.${config.rpId}`)) {
      invalid('origin must belong to the configured relying party')
    }
    if (origins.includes(origin)) invalid('origins must be unique')
    origins.push(origin)
  }
  return Object.freeze({
    rpId: config.rpId,
    rpName: config.rpName,
    origins: Object.freeze(origins),
    ...(config.allowInsecureLocalhost === undefined
      ? {}
      : { allowInsecureLocalhost: config.allowInsecureLocalhost }),
  })
}
