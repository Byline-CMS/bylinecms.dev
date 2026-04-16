# Routing & API Analysis

## Summary

Byline CMS is currently in an **internal transport phase**.

The only active client today is the admin UI inside `apps/webapp`, so document and upload operations are intentionally exposed through **TanStack Start server functions** rather than through a stable, framework-agnostic HTTP API contract.

This is deliberate.

We explicitly do **not** want to evolve ad hoc HTTP endpoints one by one while the admin UI is still the only client. Doing so would prematurely lock in a public API surface before we have the broader client requirements needed to design that surface coherently.

## Current Position

At the moment:

- The admin UI is the only client.
- TanStack Start server functions are the current transport boundary for admin actions.
- Core business logic lives below that transport boundary in framework-agnostic services such as `packages/core/src/services/document-lifecycle.ts` and `packages/core/src/services/document-upload.ts`.
- We have deliberately removed or avoided stable/public HTTP API endpoints for document and upload operations in the current implementation.

This means the current architecture is:

1. Admin UI calls TanStack Start server functions.
2. Server functions act as thin transport wrappers.
3. Core services perform the business orchestration.
4. DB adapters and storage providers remain low-level infrastructure dependencies.

## Why We Chose This

This phase keeps the architecture honest.

If we introduced a stable HTTP transport now only for uploads, we would create a misleading partial boundary:

- uploads would have a public transport shape
- create/find/update/status/history flows would still be internal TanStack RPC-style calls

That would split the application surface for no strong product reason and would likely force a later redesign once the first external client appears.

The correct trigger for a stable HTTP transport is **the arrival of the first real non-admin client**.

Examples:

- mobile app
- desktop app
- separate frontend
- external integration
- hosted remote Byline API server

Once that happens, uploads will not be the only concern. The same client will also need stable transport boundaries for:

- finding documents
- reading single documents
- creating documents
- updating documents
- changing status
- history/version access
- likely authentication and authorization semantics as well

So the stable HTTP boundary should be designed as a **phase of work across the broader application surface**, not introduced incrementally by accident around one feature.

## Current Practical Pattern

Today the intended flow is:

1. UI event in admin interface.
2. TanStack Start server function in `apps/webapp/src/modules/admin/collections`.
3. Framework-agnostic core service in `packages/core/src/services`.
4. Injected DB adapter and storage provider from `apps/webapp/byline.server.config.ts`.

This keeps the current app simple while preserving a clean separation between:

- transport
- business logic
- infrastructure adapters

## Uploads In This Model

Uploads previously risked becoming an exception to the rule because they had started to look like standalone HTTP API behavior.

That has now been corrected for the current phase:

- upload transport is back inside the TanStack Start server-function layer used by the admin UI
- upload orchestration has been extracted into a core service
- there is still **no stable/public HTTP upload contract** yet

This is important because it keeps uploads aligned with the same transport phase as the rest of the admin functionality.

## What Happens Later

When the first non-admin client arrives, the next phase should introduce a **stable HTTP transport** across the relevant surface area.

That likely means:

1. Define stable HTTP contracts for upload, read, list, create, update, status, and history operations.
2. Implement those HTTP transports as thin wrappers around the existing core services.
3. Keep TanStack Start server functions for the admin UI if they are still useful internally.
4. Allow another host framework, such as Fastify, to expose the same HTTP contracts while still using Byline Core underneath.

At that point the architecture becomes:

1. Client chooses transport.
2. Stable HTTP route or internal framework transport receives the request.
3. Transport wrapper resolves context and validates input.
4. Core services execute business logic.
5. Adapters/providers perform persistence and storage work.

## Relationship To Remote Deployments

This matters for remote deployments too.

If Byline is later hosted behind a dedicated API server, for example a Fastify application, that server should expose the stable HTTP boundary and call the same core services.

In that future model:

- TanStack Start is not required for external clients.
- TanStack server functions remain an internal convenience transport, not the public contract.
- The stable HTTP API becomes the framework-agnostic transport boundary.

## Architectural Rule

For the current phase:

- **Do not introduce stable/public HTTP API endpoints just because one operation looks transport-like.**
- **Keep admin-only flows on TanStack Start server functions while the admin UI is the only client.**
- **Move business logic into core services so a later stable HTTP transport can be added cleanly.**

## Current Conclusion

The current implementation is intentionally in a pre-public-API phase.

That means:

- no stable/public HTTP transport yet
- admin UI only
- TanStack Start server functions as internal transport
- core services prepared for future transport expansion

The stable HTTP API is not rejected. It is **deliberately deferred** until the application has its first real external client and the full transport boundary can be designed properly.