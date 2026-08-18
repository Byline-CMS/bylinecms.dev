---
title: "Auth & Security"
path: "auth-and-security"
summary: "How Byline controls who can do what, and how it records what was done: the actor and ability model, two-layer access control with read-side row scoping, and the version and document-level audit trails."
---

# Auth & Security

Companions:
- [Core composition](../03-architecture/02-core-composition.md) — where session providers, ability registries, and request-bound services enter the runtime.
- [Client SDK](../05-reading-and-delivery/01-client-sdk.md) — how every document operation resolves request authority and applies read predicates.
- [Configuration API](../10-api-reference/01-configuration.md) — the exact session, admin-store, core, and server-admin configuration surface.

Byline takes access control and provenance seriously by default rather than as a
bolt-on. This section covers both halves: deciding what an actor is allowed to
do, and keeping a faithful record of what actually happened.

- [Authentication & Authorization](./01-authn-authz.md) — actors and
  `RequestContext`, the ability registry, two-layer enforcement, read-side row
  scoping via `beforeRead`, field redaction via `afterRead`, and pluggable
  session providers. Includes worked access-control recipes.
- [Auditability](./02-auditability.md) — the per-version acting-user trail and
  the document-level audit log, plus the history and activity views built on top
  of them.
