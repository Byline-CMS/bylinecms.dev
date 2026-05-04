# noble-argon2 (vendored)

Vendored subset of [`@noble/hashes`](https://github.com/paulmillr/noble-hashes)
sufficient to compute argon2id password hashes. Vendored — rather than depended
on via npm — to remove the npm install-time supply-chain risk for the password
hashing path.

The MIT license under which we received this code is included verbatim as
`./LICENSE`.

## Why vendored

`@byline/admin` previously depended on `@node-rs/argon2`, a Rust binding that
requires a per-platform native binary. That blocks deployment to non-Node
runtimes (Workers, Deno, Bun without Node-API shims) and adds a transitive
install-time supply-chain surface. `@noble/hashes` is pure JS, runs in any
runtime with WebAssembly-free standard JS, and is explicitly designed by its
author to be auditable and vendorable.

We copy only the modules required for argon2id, in full, with attribution.
Other parts of `@noble/hashes` (sha2, sha3, scrypt, …) are not pulled in.

## Provenance

| Field                    | Value                                                       |
| ------------------------ | ----------------------------------------------------------- |
| Upstream repo            | https://github.com/paulmillr/noble-hashes                   |
| Upstream release tag     | `2.2.0`                                                     |
| Upstream commit          | `81983c2fffac48aa69dabc260b4192ad597d2734`                  |
| Upstream tag date        | 2026-04-11                                                  |
| Upstream license         | MIT (see `./LICENSE`)                                       |
| Files copied             | `argon2.ts`, `blake2.ts`, `_blake.ts`, `_u64.ts`, `_md.ts`, `utils.ts` |

The files were fetched from
`https://raw.githubusercontent.com/paulmillr/noble-hashes/<commit>/src/<file>`.

## Local modifications

Only two mechanical edits are applied to the upstream sources:

1. **Import-extension rewrite.** Relative import specifiers are rewritten from
   `'./<name>.ts'` to `'./<name>.js'`. Required by `@byline/admin`'s
   `module: NodeNext` TypeScript configuration, which emits ES modules and
   resolves imports against the emitted `.js` paths.
2. **`// @ts-nocheck` header.** A single-line `// @ts-nocheck — vendored from
   noble-hashes; see ./README.md` is prepended to every vendored `.ts` file.
   Required because this project enables `noUncheckedIndexedAccess` and a few
   other strict-mode flags that noble-hashes does not. The vendored algorithm
   code is exercised by the upstream test suite at noble's tsconfig settings,
   and additionally by `tests/noble-argon2-vectors.test.node.ts` against
   published RFC 9106 / P-H-C reference vectors, so suppressing project lint
   inside the vendored copy does not weaken the assurance we have over the
   correctness of these files.

No algorithm code, no constants, and no exported APIs have been changed.

To re-verify, fetch each file at the commit pinned above and run
`diff <upstream> <vendored>` — every diff line should be one of:

- A single-line `// @ts-nocheck` header at the top of the file
- `./_blake.ts` → `./_blake.js`
- `./_md.ts` → `./_md.js`
- `./_u64.ts` → `./_u64.js`
- `./blake2.ts` → `./blake2.js`
- `./utils.ts` → `./utils.js`

## Surface area used

`packages/admin/src/modules/auth/password.ts` consumes only `argon2id` and
`argon2idAsync` from `./argon2.js`. The other exports (`argon2d`, `argon2i`,
their async variants, the BLAKE2s class, miscellaneous utility helpers) are
present because they live in the same source files; bundlers eliminate them as
dead code.

The fidelity of this vendored copy is checked by
`packages/admin/tests/noble-argon2-vectors.test.node.ts`, which runs published
RFC 9106 / noble-hashes argon2id test vectors against this code.

## Re-syncing to a newer upstream commit

1. Pick the new release tag and resolve it to a commit SHA.
2. For each file in this directory, replace its contents with the upstream
   file at that commit.
3. Re-apply the `.ts` → `.js` import-extension change (a single sed pass:
   `sed -i '' "s|from '\\./\\([_a-z0-9]*\\)\\.ts'|from './\\1.js'|g" *.ts`).
4. Update the commit, tag, and date in the table above.
5. Run `pnpm test` in `packages/admin/` to confirm the test vectors still pass.
