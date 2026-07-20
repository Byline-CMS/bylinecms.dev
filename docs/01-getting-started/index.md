---
title: "Getting Started"
path: "getting-started"
summary: "Two ways to get started with Byline: add it to an existing TanStack Start app with the CLI, or clone this repo and run the example application in dev mode."
---

# Getting Started

The best way to get up to speed with Byline is to look at our working reference application in the main [GitHub repository](https://github.com/Byline-CMS/bylinecms.dev). The application is located in the `apps/webapp` directory, and is a fully configured Byline CMS instance built on TanStack Start. We've included several collection examples, options, and configuration settings that should give you a solid introduction to Byline.

The heart of Byline is its configuration system. In the example application — and by convention — Byline's configuration lives in `apps/webapp/byline`. This is where content collections are defined, which ultimately shapes how editors enter and manage content.

For a broader introduction that explains why Byline exists, and why we think it's special — see [Where to go next](#where-to-go-next) further below. To get started with a running instance of Byline, you have two options:

1. [CLI](./01-cli.md) — install Byline into an existing TanStack Start application with `byline init` (plus `setup` and `doctor`).
2. [Development environment and reference application](./02-development-environment.md) — clone the main repo, provision PostgreSQL, seed the database, and run the example app (`apps/webapp`) in dev mode.

If you're evaluating Byline, the development environment is the quickest way to see a working installation; the CLI is the path to adding Byline to your own app.

## Where to go next

- **Why it exists** — [Why Byline](../02-why-byline/index.md) sets out the
  motivation and the stance on AI-era content.
- **Understand the model** — [Architecture](../03-architecture/index.md) is a
  map of key architectural decisions (universal storage, immutable versioning, the schema/admin split).
- **Model your content** — [Collections](../04-collections/index.md) is the
  working reference for defining a collection, its [fields](../04-collections/01-fields.md), [blocks](../04-collections/02-blocks.md),
  [relationships](../04-collections/03-relationships.md), and
  [rich text](../04-collections/07-rich-text.md).
- **Connect the frontend** — the [Client SDK](../05-reading-and-delivery/01-client-sdk.md)
  is how a frontend or script queries and writes Byline content.
