/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/** Synthetic ES256 authenticator for real WebAuthn-library conformance, not device acceptance. */
import { createHash, generateKeyPairSync, randomBytes, sign } from 'node:crypto'

import type { PasskeyAuthenticationOptions, PasskeyRegistrationOptions } from '@byline/auth'

type Cbor = number | string | Uint8Array | Map<Cbor, Cbor>
// Only the definite-length CBOR subset needed for COSE keys and none attestation.
function cbor(value: Cbor): Buffer {
  const head = (major: number, size: number) => {
    if (size < 24) return Buffer.from([(major << 5) | size])
    if (size < 256) return Buffer.from([(major << 5) | 24, size])
    const bytes = Buffer.alloc(3)
    bytes[0] = (major << 5) | 25
    bytes.writeUInt16BE(size, 1)
    return bytes
  }
  if (typeof value === 'number') return head(value < 0 ? 1 : 0, value < 0 ? -1 - value : value)
  if (typeof value === 'string') {
    const bytes = Buffer.from(value)
    return Buffer.concat([head(3, bytes.length), bytes])
  }
  if (value instanceof Uint8Array) return Buffer.concat([head(2, value.length), value])
  return Buffer.concat([head(5, value.size), ...[...value].flatMap(([k, v]) => [cbor(k), cbor(v)])])
}
const sha = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest()
const b64 = (bytes: Buffer) => bytes.toString('base64url')

export interface CeremonyOverrides {
  origin?: string
  challenge?: string
  rpId?: string
  type?: string
  crossOrigin?: unknown
  omitCrossOrigin?: boolean
  userVerified?: boolean
  counter?: number
  userHandle?: string
  backedUp?: boolean
}

export function passkeyAuthenticator(multiDevice = false) {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
  const jwk = publicKey.export({ format: 'jwk' })
  const id = randomBytes(32)
  const cose = cbor(
    new Map<Cbor, Cbor>([
      [1, 2],
      [3, -7],
      [-1, 1],
      [-2, Buffer.from(jwk.x!, 'base64url')],
      [-3, Buffer.from(jwk.y!, 'base64url')],
    ])
  )
  function clientData(type: string, challenge: string, options: CeremonyOverrides) {
    return Buffer.from(
      JSON.stringify({
        type: options.type ?? type,
        challenge: options.challenge ?? challenge,
        origin: options.origin ?? 'https://cms.example.test',
        ...(!options.omitCrossOrigin ? { crossOrigin: options.crossOrigin ?? false } : {}),
      })
    )
  }
  function authData(rpId: string, registration: boolean, options: CeremonyOverrides) {
    const counter = Buffer.alloc(4)
    counter.writeUInt32BE(options.counter ?? 0)
    const flags =
      1 |
      (options.userVerified === false ? 0 : 4) |
      (registration ? 64 : 0) |
      (multiDevice ? 8 : 0) |
      (options.backedUp ? 16 : 0)
    return Buffer.concat([sha(options.rpId ?? rpId), Buffer.from([flags]), counter])
  }
  return {
    credentialId: b64(id),
    registration(options: PasskeyRegistrationOptions, overrides: CeremonyOverrides = {}) {
      const size = Buffer.alloc(2)
      size.writeUInt16BE(id.length)
      const authenticatorData = Buffer.concat([
        authData(options.rp.id, true, overrides),
        Buffer.alloc(16),
        size,
        id,
        cose,
      ])
      return {
        id: b64(id),
        rawId: b64(id),
        type: 'public-key',
        clientExtensionResults: { credProps: { rk: true } },
        response: {
          clientDataJSON: b64(clientData('webauthn.create', options.challenge, overrides)),
          attestationObject: b64(
            cbor(
              new Map<Cbor, Cbor>([
                ['fmt', 'none'],
                ['attStmt', new Map()],
                ['authData', authenticatorData],
              ])
            )
          ),
          transports: ['internal'],
        },
      }
    },
    authentication(
      options: PasskeyAuthenticationOptions,
      handle: string,
      overrides: CeremonyOverrides = {}
    ) {
      const client = clientData('webauthn.get', options.challenge, overrides)
      const authenticatorData = authData(options.rpId, false, overrides)
      return {
        id: b64(id),
        rawId: b64(id),
        type: 'public-key',
        clientExtensionResults: {},
        response: {
          clientDataJSON: b64(client),
          authenticatorData: b64(authenticatorData),
          signature: b64(
            sign('sha256', Buffer.concat([authenticatorData, sha(client)]), privateKey)
          ),
          userHandle: overrides.userHandle ?? handle,
        },
      }
    },
  }
}
