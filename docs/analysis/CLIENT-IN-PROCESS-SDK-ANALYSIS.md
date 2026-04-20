# Client In-Process SDK Analysis

## Summary

`@byline/client` is currently best understood as an **in-process, server-side SDK**.

It is not a transport client and it is not, by itself, evidence that Byline now
requires a stable/public HTTP API.

This distinction matters because Byline is currently in an internal transport
phase, documented in [ROUTING-API-ANALYSIS.md](./ROUTING-API-ANALYSIS.md):

- the admin UI is the only active client
- TanStack Start server functions are the internal transport boundary
- core services hold the business logic
- stable/public HTTP transport is intentionally deferred until the first real
  non-admin client arrives

`@byline/client` fits that current phase well.

## What `@byline/client` Is

The client package is a higher-level API layered on top of Byline Core and the
injected adapters.

Its current role is:

- provide a convenient read/query DSL
- shape responses for consumers
- hide low-level adapter details from callers
- eventually provide higher-level write operations that delegate to core
  services

This is visible in `packages/client/src/types.ts` and `packages/client/src/client.ts`:

- construction requires `IDbAdapter`
- construction requires `CollectionDefinition[]`
- construction may include `IStorageProvider`
- collection handles resolve collection IDs lazily and call adapters directly

That means the package assumes it is running in a trusted runtime that already
has access to Byline's server-side dependencies.

## What `@byline/client` Is Not

`@byline/client` is **not** currently:

- a browser-safe SDK
- a public HTTP client
- a framework-agnostic network transport client
- evidence that external consumers can or should talk directly to Byline over a
  stable HTTP contract yet

It does not consume a transport boundary. It consumes adapters and core
services in-process.

## Current Strategy Is Sound

The current strategy is sound if `@byline/client` continues to be used in
trusted, in-process contexts such as:

- server-side frontend rendering in an all-in-one Byline deployment
- TanStack Start loaders or other server-side execution paths
- migrations and import/export jobs
- collection management scripts
- operational tooling
- future write helpers that run in Node.js with direct access to adapters

In those environments, there is no need to introduce stable/public HTTP
transport just because the client package exists or gains more capabilities.

## Frontend Clarification

The word "frontend" can refer to two very different shapes, and the distinction
is important.

### 1. All-in-one frontend running server-side with Byline

If a frontend is built in the same deployment and uses server-side execution
paths, then `@byline/client` is a good fit.

Examples:

- TanStack Start route loaders
- server functions
- server-rendered page composition
- content fetching inside the same runtime as Byline Core

This does **not** force a stable/public HTTP API.

### 2. External frontend consuming a transport boundary

If a frontend is a separate runtime or a browser-side consumer, then
`@byline/client` in its current form is not the right boundary.

Examples:

- browser application calling a backend directly
- mobile app
- desktop app
- separately deployed frontend server
- third-party integration

These do force the question of a stable/public HTTP transport.

## Write Support Does Not Automatically Mean HTTP

As `@byline/client` evolves to support writes, that still does not by itself
mean a stable/public HTTP API is required.

If write operations are used first for:

- migrations
- collection management
- import jobs
- trusted internal automation
- filesystem or stream-based upload operations in Node.js

then those are still in-process SDK scenarios.

That includes uploads.

If the client package eventually supports file uploads from disk or binary
streams in a trusted Node environment, that is still compatible with the
current architecture phase. It does not require public HTTP endpoints yet.

## What Actually Triggers Stable HTTP

The trigger for a stable/public HTTP API is **not** "the client SDK gained more
methods".

The trigger is: **the first real client arrives that cannot safely or
practically use direct adapters and core services in-process**.

Typical examples:

- mobile app
- desktop app
- separate frontend deployment
- external integration
- hosted remote Byline service

At that point, uploads are not the only concern. The same transport boundary
must also cover:

- reads
- list/find operations
- create/update/delete operations
- status transitions
- version/history access
- likely auth semantics as well

That is why the stable/public HTTP boundary should be introduced as a broader
phase of work, not as a side effect of expanding `@byline/client`.

## Relationship To Core Services

`@byline/client` should continue to sit above the lower-level adapters and core
services.

This means:

- read methods compile DSL into adapter-consumable descriptors
- write methods delegate to framework-agnostic core services
- upload-related operations, if added for trusted in-process use, should call
  core upload services rather than inventing their own orchestration

This keeps the SDK aligned with the broader architecture:

1. adapters/providers remain low-level infrastructure
2. core services own business orchestration
3. `@byline/client` offers a more ergonomic in-process API over those pieces

## Relationship To Future Transport Clients

If Byline later needs a stable/public HTTP API, that does not mean
`@byline/client` must become the external transport client.

Two different client shapes may coexist cleanly:

### In-process SDK

- `@byline/client`
- trusted runtime only
- direct access to `IDbAdapter` and `IStorageProvider`
- richer server-side ergonomics

### Transport client

- future HTTP client SDK or thin fetch-based client
- targets stable/public HTTP endpoints
- usable by separate deployments or external consumers
- does not receive direct adapters

Those two layers do not need to be identical, and they should not be conflated.

## Practical Conclusion

The present `@byline/client` strategy is sound.

It should continue to be treated as:

- an in-process SDK
- a server-side integration surface
- a useful abstraction for all-in-one Byline deployments
- not yet a sign that stable/public HTTP transport is required

Stable/public HTTP transport should still be triggered by the first true
external client boundary, not merely by deeper capability in the in-process SDK.

## Recommended Working Rule

For the current phase:

- continue evolving `@byline/client` as an in-process/server-side SDK
- allow read-first and later write capabilities inside trusted runtimes
- do not let in-process SDK evolution accidentally define the future public API
- introduce stable/public HTTP only when a real external client forces that
  boundary across the broader application surface

## Related Documents

- [packages/client/DESIGN.md](../../packages/client/DESIGN.md)
- [ROUTING-API-ANALYSIS.md](./ROUTING-API-ANALYSIS.md)
- [CLAUDE.md](../../CLAUDE.md)