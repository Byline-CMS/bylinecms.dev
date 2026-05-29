---
title: "MCP Server"
path: "mcp"
summary: "Byline as a Model Context Protocol server — a peer transport that binds the operation layer to MCP tools/resources/prompts, with draft-by-default writes, service-account auth, and the workflow lifecycle as the human gate. The literal proof of 'AI-first'."
---

# MCP Server

> **Status: concept / decision note — not yet built; build deferred until after
> `hasMany`.** This captures the intended shape of `packages/mcp` so the
> dependencies (service-account auth, the operation layer, relationship
> completeness) are settled before code lands. Where this note and a shipped doc
> disagree, the shipped doc wins until this one loses the status banner.

Companions:
- [TRANSPORTS.md](./TRANSPORTS.md) — MCP is a **peer transport** in that family. It shares the operation layer with the HTTP bindings and differs only in how it surfaces operations (tools/resources/prompts vs HTTP routes). Read that first.
- [CLIENT-SDK.md](./CLIENT-SDK.md) — every MCP tool delegates to `CollectionHandle` / `document-lifecycle`. The hard problems (populate, status-aware reads, validation) are solved below the transport line.
- [AUTHN-AUTHZ.md](./AUTHN-AUTHZ.md) — MCP needs a non-interactive **service-account token** actor; `assertActorCanPerform` gates every tool inside the service, not in the tool handler.
- [RELATIONSHIPS.md](./RELATIONSHIPS.md) — `populate` + `hasMany` are what make MCP reads rich; relationship completeness gates a satisfying MCP experience, hence the sequencing.
- [CONTENT-IN-THE-TIME-OF-AI.md](./CONTENT-IN-THE-TIME-OF-AI.md) — the "why": structured versioning, workflow, and provenance matter *more* when an LLM is the author. MCP is where that thesis meets a keyboard.

## Overview

The [Model Context Protocol](https://modelcontextprotocol.io) lets an MCP host
(Claude Desktop, Claude in the browser, IDE agents, Cowork) discover and invoke
**tools**, read **resources**, and run **prompts** exposed by a server. An MCP
server for Byline turns a Byline installation into a first-class participant in an
agentic workflow: a model can query collections, draft documents, populate
relationships, and move content through the publishing lifecycle — under a scoped
actor, gated by the same abilities the admin UI obeys.

For an "AI-first headless CMS," this is not a side feature. It is the literal proof
of the positioning: the place where Byline's structured storage, immutable
versioning, and workflow lifecycle become tools an autonomous agent can use *safely*.

## Why it fits Byline cleanly

The MCP server is a **thin binding**, not a new subsystem, because the work is
already done below the transport line:

- **The SDK is the substrate.** A tool handler resolves a `RequestContext`, calls
  one `CollectionHandle` / `document-lifecycle` method, and serializes — the same
  shape as a TanStack server fn or an HTTP route. Populate, status-aware reads,
  `beforeRead` row-scoping, and `afterRead` shaping all come for free.
- **Zod schemas are tool schemas.** Byline already derives a Zod schema per
  collection (the schema builder). MCP tool `inputSchema` is JSON Schema. So tool
  definitions are *derived from collection definitions* rather than hand-written —
  most CMSes have no equivalent asset.
- **The workflow lifecycle is the safety model.** Immutable versioning +
  `defineWorkflow` give "AI drafts, humans publish" for free: the model creates a
  *draft version*; a human promotes it. No new safety machinery to invent.

## Scope discipline (the demo is mostly *not* Byline)

The motivating demo — *Claude researches a topic, gathers content, publishes to
several social channels, then publishes to a production Byline* — is Claude
orchestrating several MCP servers: a web/research MCP, social-channel MCPs, and
Byline's. Byline is **one node** in that graph.

```
            ┌──────────────── MCP host (Claude Desktop / Cowork) ───────────────┐
            │                                                                   │
   research MCP ──┐                                                  ┌── social-X MCP
                  ├──▶  model plans & orchestrates  ──────────────────┼── social-Y MCP
   web/fetch  ────┘                                                  └── Byline MCP ──▶ production Byline
                                                                                         (draft → review → publish)
```

This is a feature — it showcases MCP composability — but it must not inflate
Byline's build scope. Byline's job is **one tight, safe MCP over its own SDK**,
nothing more. The social and research nodes are other people's servers.

## Tool surface

Favor a **small set of generic, collection-parameterised tools** over a
combinatorial explosion of per-collection-per-verb tools. A handful of well-named
tools the model can reason about beats hundreds it must disambiguate:

| Tool                  | Maps to                                  | Notes                                        |
|-----------------------|------------------------------------------|----------------------------------------------|
| `list_collections`    | config / collection registry             | discovery — what can I work with?            |
| `describe_collection` | `CollectionDefinition` + admin config    | returns the Zod-derived field shape          |
| `query_documents`     | `CollectionHandle.find` (where/sort/populate/depth) | status-aware; published-only by default |
| `get_document`        | `findById` / `findByPath`                | optional `populate` / `depth` / `locale`     |
| `create_document`     | `document-lifecycle` create              | **always creates a draft** (see Safety)      |
| `update_document`     | `document-lifecycle` update              | whole-document / field-level; patches stay admin-internal |
| `publish_document`    | `changeStatus` (workflow transition)     | gated; the human-promotion seam              |

Two MCP affordances beyond tools are worth shipping:

- **Resources** — collections and individual documents exposed as browseable,
  attachable read-only context (`byline://collection/{path}`,
  `byline://document/{path}/{id}`). Lets a user *attach* content into a conversation
  rather than the model having to query for it.
- **Prompts** — pre-baked workflows ("draft a blog post for the `posts` collection
  from this research"), parameterised by collection. These encode the safe,
  intended authoring path so the model falls into the pit of success.

### How a tool is wired

```
   MCP host calls tool  create_document { collection: "posts", data: {...} }
                              │
                              ▼
   ┌──────────────────────── packages/mcp ───────────────────────────┐
   │  resolve service-account token  ─▶  RequestContext (scoped Actor)│
   │  inputSchema = Zod(posts)  ─▶  validate args  ─▶  structured errs │  ◀─ model self-corrects
   │  op.invoke(ctx, input)                                           │
   └──────────────────────────────┬───────────────────────────────────┘
                                   ▼
        document-lifecycle.create  ──▶  assertActorCanPerform('collections.posts.create')
                                   ──▶  beforeCreate hook · write DRAFT version
                                   ──▶  serialize  ──▶  tool result
```

The shared **operation layer** from [TRANSPORTS.md](./TRANSPORTS.md) means
`create_document` and the HTTP `POST /api/posts` route invoke the *same*
`OperationDefinition` — MCP differs only in binding (tool envelope, JSON-RPC over
stdio / Streamable HTTP) rather than re-deciding what "create a post" means. Get
this right and MCP is another binding; get it wrong and MCP is a fourth
re-implementation of the contract.

## Safety model

Autonomous writes to a production CMS are genuinely risky; the design leans on
machinery Byline already has:

1. **Draft-by-default.** `create_document` / `update_document` always write a
   *draft* version. They cannot publish.
2. **Publish is a separate, gated transition.** `publish_document` is a workflow
   `changeStatus` call, ability-gated, and ideally surfaced as the human-promotion
   seam — the model proposes, a person disposes. The service account can be
   provisioned *without* the publish ability entirely, so a misbehaving agent
   physically cannot push live content.
3. **Validation feedback loop.** Bad input returns structured Zod errors (Byline's
   stable validation codes), which the model reads and self-corrects against —
   turning the schema into a guardrail rather than a wall.
4. **Provenance.** Versions are immutable and attributable to the service-account
   actor, so "what did the AI write, and when" is answerable after the fact — the
   [CONTENT-IN-THE-TIME-OF-AI.md](./CONTENT-IN-THE-TIME-OF-AI.md) thesis in action.

## Authentication

MCP is non-interactive — there is no cookie, no login screen. It needs a
**service-account token** model: a token mints a scoped `Actor` whose abilities are
provisioned explicitly (e.g. `collections.posts.read`, `collections.posts.create`,
but *not* `collections.posts.publish`). This is new auth work — today's auth is
JWT-session, built for the admin UI — and it is shared with the HTTP API's
bearer-token need (see [TRANSPORTS.md](./TRANSPORTS.md) → the auth seam). The
`SessionProvider` interface in `@byline/auth` is the extension point.

## Transport and deployment

MCP defines two transports; both are relevant:

```
  A) stdio  — host launches the MCP process locally
     Claude Desktop ──spawn──▶ byline-mcp (local) ──HTTP──▶ remote Byline /api
     requires the HTTP boundary (TRANSPORTS.md) to exist first.

  B) Streamable HTTP — MCP server is a deployed, networked endpoint
     Claude (any host) ──HTTPS──▶ byline-mcp (co-located w/ Byline) ──in-proc──▶ @byline/client ──▶ Postgres
     the MCP server embeds the SDK and IS the remote boundary.
```

**Recommendation: (B), co-located Streamable HTTP**, embedding `@byline/client`
and talking straight to the adapter. It sidesteps needing a separate REST round-trip
for the "publish to production Byline" story and lets MCP be its *own* remote
boundary. Option (A) is viable too but couples MCP's ship date to the HTTP family's.
Either way the MCP server is `packages/mcp` and consumes the shared operation layer.

## Sequencing — why after `hasMany`

The thing that makes an MCP read experience impressive is **rich, populated
content**. An MCP that cannot represent many-to-many relationships will feel thin,
and relationship completeness (`hasMany`) is high on the TODO already. So:

- Land `hasMany` and confirm `populate` is complete across relation cardinalities.
- Land the operation layer + `http-nitro` (proves the contract; see TRANSPORTS.md).
- Then build `packages/mcp` as a binding over that proven surface.

Building MCP before the operation layer exists would mean inventing the contract
inside the MCP package and re-inventing it again for HTTP — the precise drift
TRANSPORTS.md is structured to avoid.

## Code map (planned)

| Concern                          | Intended location                                      |
|----------------------------------|--------------------------------------------------------|
| MCP server entry / transport     | `packages/mcp/src/server.ts` (stdio + Streamable HTTP) |
| Tool definitions (generic verbs) | `packages/mcp/src/tools/`                              |
| Resource providers               | `packages/mcp/src/resources/`                          |
| Prompt templates                 | `packages/mcp/src/prompts/`                            |
| Zod → MCP inputSchema bridge     | `packages/mcp/src/schema/`                             |
| Shared operation layer           | `packages/http/src/operations/` (see TRANSPORTS.md)    |
| Service-account actor + provider | extends `@byline/auth` `SessionProvider` (new work)    |

## Open questions

- **Tool granularity vs collection count.** Generic `query_documents` keeps the tool
  list small, but very large installs may benefit from a few collection-specific
  prompts to steer the model. Measure before specialising.
- **Dynamic tool listing.** Should the tool list reflect the actor's abilities
  (hide `publish_document` if the token can't publish)? Leaning yes — fewer tools
  the model can misuse.
- **Resource volume.** Exposing every document as a resource does not scale;
  resources likely list collections + recent/queried documents, not the full corpus.
- **Streaming long writes.** Whether large create/update results stream progress
  back over Streamable HTTP, or return once. Probably return-once to start.
- **Where the operation layer finally lives** — `packages/http` vs lifted into
  `@byline/core` — is decided when MCP proves the HTTP/MCP overlap (TRANSPORTS.md).
