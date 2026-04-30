/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Client-side shim for `@node-rs/argon2`.
 *
 * Vite resolves `@node-rs/argon2` for the client environment via the
 * package's `"browser": "browser.js"` field, and `browser.js` is
 * `export * from '@node-rs/argon2-wasm32-wasi'` — a WASM peer we
 * neither install nor want on the client. `vite.config.ts` aliases
 * that WASM peer to *this* file.
 *
 * Why a shim instead of an empty module: TanStack Start strips
 * `createServerFn().handler(...)` bodies on the client, but it does
 * **not** strip the file's top-level `import` statements. So
 * `import { hash, verify } from '@node-rs/argon2'` inside
 * `packages/admin/src/modules/auth/password.ts` is still evaluated
 * on the client when its parent module is loaded — the import has
 * to resolve to a module that exposes the named bindings, even
 * though the bindings are never called.
 *
 * Each export here is a defensive throwing stub: if any of them ever
 * actually runs on the client it indicates server-only code
 * accidentally executing in the browser, and the loud failure is
 * better than silently producing a bad hash.
 *
 * Mirrors the named exports of `@node-rs/argon2` v2 (see
 * `node_modules/@node-rs/argon2/index.d.ts`). Add new entries here if
 * a future version adds new named exports that downstream code
 * imports directly.
 */

const serverOnly = (name: string): never => {
  throw new Error(
    `@node-rs/argon2.${name}() is server-only — should never run on the client. ` +
      'This indicates code outside a server-fn handler is calling argon2.'
  )
}

export const hash = (..._args: unknown[]): Promise<string> => serverOnly('hash') as never
export const hashRaw = (..._args: unknown[]): Promise<Uint8Array> => serverOnly('hashRaw') as never
export const hashRawSync = (..._args: unknown[]): Uint8Array => serverOnly('hashRawSync') as never
export const hashSync = (..._args: unknown[]): string => serverOnly('hashSync') as never
export const verify = (..._args: unknown[]): Promise<boolean> => serverOnly('verify') as never
export const verifySync = (..._args: unknown[]): boolean => serverOnly('verifySync') as never

// argon2's Algorithm and Version enums are `const enum` in TypeScript,
// which inline at compile time — so the import is type-only and these
// runtime stubs never actually need to match the enum values. They
// exist only to satisfy any rare value-side import.
export const Algorithm = { Argon2d: 0, Argon2i: 1, Argon2id: 2 } as const
export const Version = { V0x10: 0x10, V0x13: 0x13 } as const
