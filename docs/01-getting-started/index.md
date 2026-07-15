---
title: "Getting Started"
path: "getting-started"
summary: "Two ways to get started with Byline: add it to an existing TanStack Start app with the experimental CLI, or clone this repo and run the example application in dev mode."
---

There are two ways to get started with Byline:

- [Experimental CLI](./01-experimental-cli.md) — install Byline into an existing TanStack Start application with `byline init` (plus `setup` and `doctor`).
- [Development environment and example application](./02-development-environment.md) — clone this repo, provision PostgreSQL, seed the database, and run the example app (`apps/webapp`) in dev mode.

Existing 3.21 applications should follow [Upgrading from 3.21 to 4.0](./03-upgrading-to-v4.md).

If you're evaluating Byline, the development environment is the quickest way to see a working install; the CLI is the path to adding Byline to your own app.

## Where to go next

- **Understand the model** — [Architecture](../03-architecture/index.md) is the
  map of the load-bearing decisions (universal storage, immutable versioning, the
  schema/admin split).
- **Model your content** — [Collections](../04-collections/index.md) is the
  working reference for defining a collection, its [fields](../04-collections/01-fields.md),
  [relationships](../04-collections/02-relationships.md), and
  [rich text](../04-collections/06-rich-text.md).
- **Read it back out** — the [Client SDK](../05-reading-and-delivery/01-client-sdk.md)
  is how a frontend or script queries and writes Byline content.
- **Why it exists** — [Why Byline](../02-why-byline/index.md) sets out the
  motivation and the stance on AI-era content.
