---
title: "Getting Started"
path: "getting-started"
summary: "Two ways to get started with Byline: add it to an existing TanStack Start app with the CLI, or clone this repo and run the example application in dev mode."
---

# Getting Started

Companions:
- [Configuration](./03-configuration.md) — a guided tour of the application-owned files and their server, admin, schema, and public boundaries.
- [Key architectural decisions](../03-architecture/index.md) — the storage, versioning, schema/presentation, and authorization model behind the setup.
- [Collections](../04-collections/index.md) — the first subsystem to configure after the application is running.

The best way to get up to speed with Byline is to look at our working reference application in the main [GitHub repository](https://github.com/Byline-CMS/bylinecms.dev). The application is located in the `apps/webapp` directory, and is a fully configured Byline CMS instance built on TanStack Start. We've included several collection examples, options, and configuration settings that should give you a solid introduction to Byline.

The heart of Byline is its configuration system. In the example application — and by convention — Byline's configuration lives in `apps/webapp/byline`. This is where content collections are defined, which ultimately shapes how editors enter and manage content.

For a broader introduction that explains why Byline exists, and why we think it's special — see [Where to go next](#where-to-go-next) further below. To get started with a running instance of Byline, you have two options:

1. [CLI](./01-cli.md) — install Byline into an existing TanStack Start application with `byline init` (plus `setup` and `doctor`).
2. [Development environment and reference application](./02-development-environment.md) — clone the main repo, provision PostgreSQL, seed the database, and run the example app (`apps/webapp`) in dev mode.

If you're evaluating Byline, the development environment is the quickest way to see a working installation; the CLI is the path to adding Byline to your own app.

Once the application is running, [Configuration](./03-configuration.md) explains every application-owned file under `apps/webapp/byline`, which runtime imports it, and where each kind of customization belongs. Existing 3.21 installations should first follow [Upgrading from 3.21 to 4.x](./04-upgrading-to-v4.md); 4.11 installations should then follow [Upgrading from 4.11 to 4.12](./05-upgrading-to-v4-12.md).

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
- **Look up an exact contract** — the [API Reference](../10-api-reference/index.md)
  lists configuration properties, collection and field options, and every public Client SDK method.
