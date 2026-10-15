---
title: "Passkeys — runtime compatibility decision"
path: "passkeys-runtime-compatibility"
summary: "Resolve the difference between Byline's advertised Node floor and SimpleWebAuthn's documented runtime support before adopting the passkey dependencies."
---

# Passkeys — runtime compatibility decision

Companions:

- [Passkey implementation plan](./2026-09-10-passkeys-phase-1-plan.md#stage-1--contracts-and-configuration) requires dependency and runtime evidence before adoption.
- [Passkey specification](./2026-09-10-passkeys-phase-1-spec.md) requires optional support and compatibility for installations without passkeys.

Date: 2026-10-16 (Asia/Bangkok). Status: approved by Tony during Stage 1. Raise the project-wide floor to Node `>=22.22.2` within the passkeys implementation; no separate compatibility change is required. Package versions and release publication remain unchanged.

## Evidence

The initial registry queries were `pnpm view @simplewebauthn/server version engines --json` and `pnpm view @simplewebauthn/browser version engines --json`. Exact-version queries then included dependencies, deprecation metadata, publication times, tarball URLs, and integrity values. Registry access used `https://registry.npmjs.org/`; the sandboxed commands stalled, and the same commands succeeded with network-capable execution.

| Package | Exact candidate | Published `engines` | Published release date | Observations |
| --- | --- | --- | --- | --- |
| `@simplewebauthn/server` | `14.0.3` | `node: >=20.0.0` | 2026-09-25 | Current registry release; no deprecation field returned. |
| `@simplewebauthn/browser` | `14.0.0` | No field returned | 2026-09-02 | Current registry release; no runtime dependencies or deprecation field returned. Missing engines is not compatibility evidence. |
| `@peculiar/x509` | `2.1.0` / current `2.2.0` | `node: >=20.0.0` for both | Not used for this decision | Server declares `^2.1.0`; these metadata checks do not establish the complete resolved dependency graph. |

The [official server documentation](https://simplewebauthn.dev/docs/packages/server) identifies its current version as `14.0.x` and lists installation support for Node LTS 22.x and higher. The [browser documentation](https://simplewebauthn.dev/docs/packages/browser) describes the paired browser package. Recent published releases and current documentation establish an actively published candidate; they do not promise future maintenance or support on Node 20.

At the starting revision, Byline's root and package manifests advertised `>=20.9.0`. The CLI preflight in `packages/cli/src/phases/preflight.ts` advertised Node 20.9+, while `.github/workflows/ci.yml` uses Node 22. The local execution runtime is Node `24.18.0`. The initial inspection preceded the Node 22.0.0 smoke proof recorded below; no Node 20.9 proof is claimed. The npm engine declaration alone cannot resolve the difference with the library's documented support policy.

The reviewer identified an additional support-policy fact: the [official Node release schedule](https://github.com/nodejs/Release/blob/main/schedule.json) gives Node 20 an end-of-life date of 2026-04-30, and Node 22 an end-of-life date of 2027-04-30. These dates were independently verified. Retaining the old floor therefore means supporting an end-of-life runtime that current CI does not exercise.

## Approved decision

Tony approved increasing the project-wide Node floor as part of this work: “We don't require a separate compatibility change - let's increase the node.js floor of this project.” The selected floor is `>=22.22.2`. Update root and package manifests, CLI preflight and its tests, and current runtime documentation. CI already uses Node 22. This applies to password-only deployments too; no conditional passkey-only runtime gate or Node 20 compatibility work is needed. No package-version bump or release policy is selected here.

## Effective floor from the workspace graph

Checkpoint 1 review caught a distinction between the WebAuthn runtime proof and Byline's existing dependency graph. The committed `pnpm-lock.yaml` declares these constraints:

| Dependency | Node constraint | Consumer |
| --- | --- | --- |
| `vite@8.3.4`, `rolldown@1.2.14`, `unplugin@3.4.0` | `^20.19.0 || >=22.12.0` | Host and application build chain |
| `vitest@5.0.4` | `^22.12.0 || ^24.0.0 || >=26.0.0` | Workspace tests |
| `undici@8.12.1` | `>=22.19.0` | jsdom tests |
| `lint-staged@17.6.0` | `>=22.22.1` | Pre-commit hook |
| `w3c-xmlserializer@6.0.0` | `^22.22.2 || ^24.15.0 || >=26.0.0` | jsdom tests |

The first snapshot's `>=22.0.0` floor was therefore insufficient for Byline. Use one conservative minimum, `>=22.22.2`, for the published packages, CLI admission, and contributor workspace, rather than separate installation and contributor minima. This implements Tony's instruction to increase the project floor. The WebAuthn proof on 22.0.0 remains valid evidence for those libraries alone; the existing graph determines the effective project minimum. For contributor development, use Node 22.22.2+ on the 22 LTS line or Node 24.15+ on the 24 LTS line; not every intermediate major/minor accepted by the project's open-ended engine range is supported by every development tool.

A read-only semver scan of all package sections in the workspace lockfile checked 747 declared Node engine constraints. Node 22.22.2 satisfies 746. The exception is the optional `@img/sharp-win32-ia32@0.35.5` binary (`^20.9.0`, Windows 32-bit only), which is not selected on this macOS ARM64 environment. Compatibility with that target is not claimed; supported deployment targets must have a Sharp binary compatible with the selected Node runtime. Missing engine declarations remain outside this static proof.

## Runtime proof

An isolated installation under `/private/tmp/byline-passkeys-runtime-proof` resolved server `14.0.3`, browser `14.0.0`, and Node `22.0.0`. A synthetic ES256 credential completed registration and authentication through the real library; wrong challenge, wrong origin, and an invalid signature were rejected. Options required discoverable credentials and user verification. Importing the browser helpers without browser globals also passed. This is a runtime compatibility proof, not real-device acceptance or a complete WebAuthn security suite.

The resolved graph contains `@peculiar/x509@2.2.0` (Node >=20), `@peculiar/asn1-*` packages at `2.11.0` (Node >=14), `asn1js@3.0.10` (Node >=12), `pvutils@1.2.0` (Node >=16), and `tsyringe@4.10.0` (Node >=6). Packages without an engine declaration are `@hexagon/base64@1.1.28`, `@levischuck/tiny-cbor@0.2.11`, `@peculiar/utils@2.0.3`, `pvtsutils@1.3.6`, `reflect-metadata@0.2.2`, and `tslib@2.8.1`/`1.14.1`, plus the browser package. No declared transitive constraint exceeds Node 22.0.0. Repeat the check against the eventual workspace lockfile when dependencies are added; the isolated graph is not a workspace lock.

The reproducible proof script is `/private/tmp/byline-passkeys-runtime-proof/proof.mjs` (SHA-256 `bd21800ec692dfc657f0edd7efd7f94992247363b623fbb60203bdad6c869dfa`), executed with that directory's `node_modules/node/bin/node`. Its isolated `package-lock.json` has SHA-256 `c15b026cd63f98084aa18311c33e7fa8d91f4b3abad4188fd93eb555b10d4cbe`. These temporary artifacts are local evidence; the report does not assume they travel to another machine.

After the review correction, the same unchanged proof script passed on exact Node `22.22.2`, installed independently under `/private/tmp/byline-passkeys-node-floor`. The CLI preflight and workspace regression suites also passed on that runtime (44 tests, including rejection of 22.0.0, 22.11.9, 22.12.0, and 22.22.1, and acceptance at exactly 22.22.2). The earlier isolated lock and script hashes remain unchanged.

The exact candidate pair is selected for integration. Dependency adoption can wait until the implementation consumes it; unused runtime dependencies are not needed merely for contract declarations.

## Verification after the decision

- Preserve this runtime policy and exact dependency evidence when adding the pair to the workspace.
- Resolve and inspect the complete dependency graph, including transitive engine constraints.
- Test server imports, options generation and verification with the chosen minimum runtime, including proof failures, and check that the browser package imports without eagerly accessing browser globals during server rendering.
- Keep cryptographic verification out of browser-safe configuration imports and retain a compiling/running password-only custom provider.
- Include the evidence and remaining limitations in the Stage 1 handoff. This proposal does not replace later cryptographic, integration, or real-device acceptance.

## Release note — minimum Node runtime

The next release containing this change requires Node `>=22.22.2` for all Byline packages and the CLI, including installations using password-only sign-in. Upgrade any deployed runtime below 22.22.2 before updating Byline. This is an intentional compatibility change authorized during passkeys implementation; the release version will be chosen by the maintainer. CI already runs Node 22, and this change does not alter `@types/node` versions or publish packages.

The passkey persistence change also adds a required `passkeys` repository member to `AdminStore`. Both first-party adapters implement it. Third-party `AdminStore` adapters must implement this repository contract when updating, even if their installation has not yet enabled passkeys. The separate `SessionProvider` passkey capability remains optional for password-only/custom authentication providers. Include both compatibility changes in the release-facing changeset/CHANGELOG.
