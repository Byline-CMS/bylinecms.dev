---
title: "Reading & Delivery"
path: "reading-and-delivery"
summary: "How content leaves Byline and reaches its readers — the typed client SDK, the server-function transport surface, future HTTP transports, markdown and llms.txt for agents, an MCP server, a pluggable search/retrieval seam, and the caching strategy that ties them together."
---

# Reading & Delivery

Modeling content is only half the job; the other half is getting it out to the
things that read it — browsers, other services, and increasingly language models
and agents. This section covers every way content leaves Byline and how to serve
it efficiently.

- [Client SDK](./01-client-sdk.md) — `@byline/client`, the typed, DSL-style API
  for querying and writing documents from outside the admin UI.
- [Routing & API](./02-routing-and-api.md) — the current transport surface
  (TanStack Start server functions) and the boundary where a stable HTTP API
  becomes worthwhile.
- [Transports](./03-transports.md) — how Byline layers framework-agnostic logic
  under host-specific bindings so the same operations can be exposed over
  different transports.
- [Markdown Export](./04-markdown-export.md) — one-way Lexical-to-markdown
  rendering, the `.md` URL surface, and `llms.txt` for agent consumers.
- [MCP Server](./05-mcp-server.md) — exposing Byline content to AI agents over
  the Model Context Protocol.
- [Caching](./06-caching.md) — CDN edge caching, invalidation strategies, and the
  optional in-memory data cache.
- [Search & Retrieval](./07-search.md) — the pluggable `SearchProvider` seam
  (Postgres full-text search built in, vector / hybrid as external drivers),
  shipped collection/zone search, hydration, and post-ranking authorization,
  exposed through the Client SDK surfaces developers build site search on.
