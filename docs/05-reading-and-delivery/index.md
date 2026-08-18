---
title: "Reading & Delivery"
path: "reading-and-delivery"
summary: "How content leaves Byline and reaches its readers through the typed client SDK, server-function transports, markdown and llms.txt exports, future MCP support, and application caching."
---

# Reading & Delivery

Companions:
- [Collections](../04-collections/index.md) — the schemas that determine what the delivery surfaces read and serialize.
- [Client SDK](./01-client-sdk.md) — the primary in-process read and write API.
- [Client SDK API](../10-api-reference/04-client-sdk.md) — every public client and collection-handle method with its options and return shape.

Modeling content is only half the job; the other half is getting it out to the
things that read it: browsers, other services, and increasingly language models
and agents. This section covers every way content leaves Byline and how to serve
it efficiently.

- [Client SDK](./01-client-sdk.md) — `@byline/client`, the typed, DSL-style API
  for querying and writing documents from outside the admin UI.
- [Routing & API](./02-routing-and-api.md) — the current transport surface
  (TanStack Start server functions) and the boundary where a stable HTTP API
  becomes worthwhile.
- [Transports](./03-transports.md) **(planned)** — how Byline intends to layer framework-agnostic logic
  under host-specific bindings so the same operations can be exposed over
  different transports.
- [Markdown Export](./04-markdown-export.md) — one-way Lexical-to-markdown
  rendering, the `.md` URL surface, and `llms.txt` for agent consumers.
- [MCP Server](./05-mcp-server.md) **(planned)** — exposing Byline content to AI agents over
  the Model Context Protocol.
- [Caching](./06-caching.md) — CDN edge caching, invalidation strategies, and the
  optional in-memory data cache.
- [Search](../06-search/index.md) — ranked collection and zone search, portable
  multilingual analysis, and built-in PostgreSQL and MySQL providers now have a
  dedicated section.
