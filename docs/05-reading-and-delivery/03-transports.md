---
title: "Transports"
path: "transports"
summary: "The pluggable transport family — a single framework-agnostic operation contract bound to many runtimes (Nitro, Fastify, Hono) plus MCP as a peer transport. The concrete shape of the stable boundary ROUTING-API.md defers."
---

# Transports

:::note[Status]
**Concept / decision note — not yet built.** This document captures the
intended architecture for Byline's transport layer *before* code lands, so the
contract-first shape is settled and the work can be sequenced against the auth
subsystem and `hasMany`. It is the concrete form of the "stable HTTP boundary
phase" that [ROUTING-API.md](./02-routing-and-api.md) explicitly defers until the first
non-admin client arrives. Where this note and a shipped doc disagree, the shipped
doc wins until this one loses the status banner.
:::

Companions:
- [ROUTING-API.md](./02-routing-and-api.md) — the current internal-transport phase and *why* a stable boundary is deferred. This note is the answer to "what triggers it / what does it look like."
- [CLIENT-SDK.md](./01-client-sdk.md) — `@byline/client` is the in-process transport and the layer every other transport delegates to. Transports are bindings over the same `CollectionHandle` / `document-lifecycle` surface.
- [AUTHN-AUTHZ.md](../06-auth-and-security/01-authn-authz.md) — service-layer enforcement (`assertActorCanPerform`) means transports carry no policy; they only resolve a `RequestContext`. The per-transport context resolver is the one genuinely pluggable auth seam.
- [MCP.md](./05-mcp-server.md) — MCP is a *peer transport* in this family, sharing the operation layer but binding it to tools/resources/prompts instead of HTTP routes.
- [RELATIONSHIPS.md](../04-collections/02-relationships.md) — `populate` / `depth` are part of the operation surface every transport exposes; relationship completeness (`hasMany`) gates a satisfying read experience over any transport.

## Overview

A **transport** is a binding that exposes Byline's operations to a particular kind
of caller. Byline already has one transport — the in-process `@byline/client` SDK
— and one internal-only transport — the TanStack Start server functions in
`@byline/host-tanstack-start`. This note describes the family that completes the
picture: a stable, framework-agnostic HTTP contract bound to multiple runtimes,
plus MCP as a peer.

The load-bearing idea is a strict separation that the naïve "one package per
framework" layout gets wrong:

- **The contract** — the operation surface (verb, path, input schema, error
  envelope, pagination, the required ability, the serializer). This is the thing
  **Byline owns**, defined exactly once.
- **The binding** — how a specific runtime (Nitro/h3, Fastify, Hono) registers
  routes, parses bodies, streams responses, and sets headers.

If each framework package re-implements the contract, the surfaces drift, and the
create / update / read / list / status / upload / auth surface gets maintained N
times — exactly the "misleading partial boundary / later redesign" cost
[ROUTING-API.md](./02-routing-and-api.md) warns about, multiplied by framework count. So
the contract is declarative and shared (the same instinct as the
[store manifest](../03-architecture/01-document-storage.md)); bindings only know how to iterate
it.

## The layering

```
        ┌──────────────────────────────────────────────────────────────────┐
        │  Core services  (framework-agnostic business logic)               │
        │    document-lifecycle · document-read · populate · field-upload    │
        │    @byline/client CollectionHandle · @byline/admin commands        │
        └──────────────────────────────────────────────────────────────────┘
                                       ▲
                                       │  invoke(ctx, input)
        ┌──────────────────────────────┴───────────────────────────────────┐
        │  Operation layer   (the contract — defined once)                  │
        │    OperationDefinition[] :                                        │
        │      name · kind(read|write) · inputSchema(Zod)                   │
        │      requiredAbility · invoke(ctx,input) · serialize · errors     │
        │    + ContextResolver interface  (request ─▶ RequestContext)       │
        └───────┬───────────────────────────────────────────┬──────────────┘
                │                                            │
        ┌───────┴────────────── HTTP family ────────┐   ┌────┴──────────────┐
        │                                           │   │   MCP (peer)      │
   ┌────┴─────┐   ┌──────────┐   ┌──────────┐       │   │   packages/mcp    │
   │http-nitro│   │http-     │   │http-hono │  ...  │   │  tools ◀ schema   │
   │  (h3)    │   │ fastify  │   │ (edge)   │       │   │  resources ◀ cols │
   └────┬─────┘   └────┬─────┘   └────┬─────┘       │   │  prompts ◀ wflow  │
        │              │              │            │   └─────────┬─────────┘
        ▼              ▼              ▼            ▼             ▼
   in-process      standalone     edge runtime              stdio /
   (TanStack       API server     (Workers,                 Streamable HTTP
    host, Node)    (Node)          Deno, etc.)               (Claude clients)
```

Read the diagram top-down: **business logic never moves**. The operation layer
names the public surface once. Each binding below it knows *how to talk to its
runtime* and *nothing about what an operation does*. Adding a runtime is a new
binding. Adding an operation is a one-line manifest change every binding picks up
for free.

## Why bindings, not re-implementations

A binding is mechanical. Given `OperationDefinition[]`, an HTTP binding iterates
it and registers routes; it does not decide what `/api/:collection` *means*:

```ts
// packages/http-fastify — illustrative, not final
export function registerByline(app: FastifyInstance, ops: OperationDefinition[]) {
  for (const op of ops) {
    app.route({
      method: httpMethodFor(op),          // read → GET, write → POST
      url: pathFor(op),                    // /api/:collection[/:id][/status] …
      handler: async (req, reply) => {
        const ctx = await resolveContext(req)          // the auth seam
        const input = op.inputSchema.parse(req)        // Zod → 400 envelope
        const result = await op.invoke(ctx, input)     // one core-service call
        reply.send(op.serialize(result))
      },
    })
  }
}
```

`http-nitro` is the same loop against h3; `http-hono` the same against Hono. The
contract — paths, schemas, abilities, error envelope — lives once in
`packages/http`. This is the property the store manifest gives storage: positional
/ surface drift becomes structurally impossible because there is only one source.

## The auth seam

Transports carry **no policy** — `assertActorCanPerform` (documents) and
`assertAdminActor` (admin management) run inside the core/admin services, so every
transport inherits the gate for free (see [AUTHN-AUTHZ.md](../06-auth-and-security/01-authn-authz.md)). The
one thing that genuinely varies per transport is *how an incoming request becomes a
`RequestContext`*:

| Transport            | Context resolver reads…                              |
|----------------------|------------------------------------------------------|
| TanStack server fns  | cookie + `JwtSessionProvider` (interactive admin)    |
| HTTP API (any binding)| `Authorization: Bearer` — API key / token actor      |
| MCP                  | service-account token → scoped `Actor` (see MCP.md)  |
| in-process client    | caller passes `RequestContext` directly              |

So the operation layer defines a single `ContextResolver` interface — "give me a
`RequestContext` from this request" — and each transport supplies its own. The
bearer/API-key actor model and the MCP service-account model are **new auth work**
and the real prerequisite for any non-cookie transport; today's auth is
JWT-session, built for an interactive UI.

## Mapping to the deployment scenarios

The transport family is exactly the four deployment shapes in the
[README](../README.md), made concrete:

```
 Scenario 1 — integrated all-in-one (today)
 ┌─────────────────────────────────────────┐
 │ TanStack host                           │
 │   admin UI ─▶ server fns ─▶ @byline/client ─▶ Postgres
 │   (no exposed transport)                │
 └─────────────────────────────────────────┘
        no HTTP family needed

 Scenario 2 — integrated host + exposed HTTP API
 ┌─────────────────────────────────────────┐
 │ TanStack host (already runs Nitro/h3)   │
 │   admin UI ─▶ server fns ─▶ client ──┐  │
 │   http-nitro routes ─────────────────┤  │──▶ Postgres
 │   (co-mounted in the SAME server)    │  │
 └──────────────────────────────────────┼──┘
   external clients ─▶ /api ─────────────┘

 Scenario 3 — admin host + standalone API host
 ┌──────────────────┐        ┌──────────────────────┐
 │ admin host        │        │ http-fastify server   │
 │  admin UI + fns   │        │  /api over the network│
 └────────┬──────────┘        └───────────┬───────────┘
          └────────── shared Postgres ─────┘
   front-end host ─▶ http-fastify /api

 Scenario 4 — three dedicated hosts
   admin host (no HTTP)  ┐
   http-fastify API host ┼─ admin + API share Postgres
   front-end host ───────┘  front-end consumes API host
```

The elegant part of **scenario 2**: the all-in-one host *already runs on Nitro/h3*
(TanStack Start's server). So `http-nitro` is not "stand up an API server" — it is
"register a route module into the server you already deploy." Zero new
infrastructure, and the cheapest possible real proof of the contract layer.

## Package layout

| Package              | Role                                                                 |
|----------------------|----------------------------------------------------------------------|
| `packages/http`      | The contract. `OperationDefinition[]`, HTTP method/path mapping, error envelope, pagination shape, `ContextResolver` interface. No framework imports. |
| `packages/http-nitro`| Binding. Iterates the manifest into h3 route handlers. Co-mounts in the TanStack host (scenario 2). **Ship first.** |
| `packages/http-fastify`| Binding. Standalone Node API server (scenarios 3/4). Ships when split-host demand appears. |
| `packages/http-hono` | Binding. Edge/Workers/Deno runtimes. Deferred until an edge consumer exists. |
| `packages/mcp`       | Peer transport. Binds the *same* operations to MCP tools/resources/prompts. See [MCP.md](./05-mcp-server.md). Ships after `hasMany`. |

Whether the transport-agnostic `OperationDefinition[]` lives in `packages/http` or
is factored up into `@byline/core` is left open until MCP proves what is genuinely
shared between HTTP and MCP. Pragmatically: define it inside `packages/http` first,
designed so the descriptors are *extractable*, and lift the shared core out only
when `packages/mcp` lands and demonstrates the overlap. Do not pre-abstract for a
consumer that does not exist yet.

## Restraint

Every `@byline/http-*` / `@byline/mcp` package is lockstep-release surface and docs
surface. Do **not** publish the empty matrix for symmetry. Ship in this order, each
gated by real demand:

1. `packages/http` (contract) **+** `packages/http-nitro` — together, because the
   contract is unproven until something binds it, and Nitro is the cheapest binding
   (the host already runs it).
2. `packages/http-fastify` — when a split-host / standalone-API deployment
   (scenario 3/4) is actually needed.
3. `packages/mcp` — after `hasMany`, so the operation surface exposes complete
   relationships (see [MCP.md](./05-mcp-server.md)).
4. `packages/http-hono` — only when an edge runtime consumer exists.

## Relationship to ROUTING-API.md

[ROUTING-API.md](./02-routing-and-api.md) describes the *current* phase (server fns are the
only transport; stable HTTP deferred) and lists what triggers the next phase — "the
arrival of the first real non-admin client." This note is that next phase, designed
ahead of the trigger so it is not improvised one endpoint at a time. The rule from
that doc still holds and is reinforced here: **the HTTP boundary is designed across
the full surface area at once, as a contract, not grown incrementally around one
operation.**

When this family ships, the architecture from ROUTING-API.md's closing diagram
becomes literal:

```
 client → chooses transport →
   stable HTTP route  (http-nitro / http-fastify / http-hono) ──┐
   MCP tool/resource  (packages/mcp)                            ──┤→ operation layer
   internal server fn (host-tanstack-start)                     ──┤   → core services
   in-process client  (@byline/client)                          ──┘     → adapters
```

## Code map (planned)

| Concern                              | Intended location                                  |
|--------------------------------------|----------------------------------------------------|
| Operation contract / manifest        | `packages/http/src/operations/`                    |
| HTTP method + path mapping, envelope | `packages/http/src/contract/`                      |
| `ContextResolver` interface          | `packages/http/src/context/`                       |
| Nitro/h3 binding                     | `packages/http-nitro/src/`                         |
| Fastify binding                      | `packages/http-fastify/src/`                       |
| Hono binding                         | `packages/http-hono/src/`                          |
| MCP binding                          | `packages/mcp/src/` (see [MCP.md](./05-mcp-server.md))       |
| Bearer / API-key actor + provider    | extends `@byline/auth` `SessionProvider` (new work)|
| Core services (unchanged)            | `packages/core/src/services/`                      |

## What we deliberately defer

- **A GraphQL transport.** Possible as another peer binding later; not in the first phase.
- **OpenAPI emission.** The `OperationDefinition[]` manifest is the natural source for an OpenAPI document, but generating one waits until the HTTP contract has shipped and stabilised.
- **Per-binding bespoke routes.** Bindings iterate the manifest; they do not add hand-written one-off endpoints. If an operation is missing, it is added to the contract, not to a binding.
- **Edge/Hono and standalone Fastify packages** until a real consumer for each exists (see Restraint).
