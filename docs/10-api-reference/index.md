---
title: "API Reference"
path: "api-reference"
summary: "Exact configuration, collection, field, and Client SDK contracts, with links to the subsystem references that own search, authentication, uploads, rich text, routing, and storage."
---

# API Reference

Companions:
- [Configuration](../01-getting-started/03-configuration.md) — an introductory tour of the application files and runtime boundaries behind these contracts.
- [Key architectural decisions](../03-architecture/index.md) — the design context for the APIs listed here.
- [Scheduling](../11-scheduling/index.md) — the `ServerConfig` scheduling properties in context: recurring tasks, the ticker, and scheduled publication.
- [Testing](../12-testing.md) — the unit, integration, and browser suites used to verify these contracts.

This section is the lookup surface for Byline's application-facing APIs. Use it when you know which system you are configuring and need the exact properties, defaults, parameters, return shapes, or runtime restrictions.

## Core references

- [Configuration API](./01-configuration.md) documents `BaseConfig`, `AdminConfig`, `ServerConfig`, `BylineCore`, configuration registration, and server client getters.
- [Collections API](./02-collections.md) documents `CollectionDefinition`, `CollectionAdminConfig`, `BlockAdminConfig`, workflow configuration, and lifecycle hooks.
- [Fields API](./03-fields.md) documents the common field contract, all 22 built-in field kinds, default values, validation, hooks, and admin field overrides.
- [Client SDK API](./04-client-sdk.md) documents `BylineClientConfig`, `BylineClient`, every public `CollectionHandle` method, shared read and write options, and result envelopes.

## Subsystem references

These existing documents remain the canonical references for their narrower contracts:

| Surface | Canonical reference |
|---|---|
| Authentication, actors, abilities, and sessions | [Authentication and authorization](../07-auth-and-security/01-authn-authz.md) |
| Audit log and version attribution | [Auditability](../07-auth-and-security/02-auditability.md) |
| File and image uploads, `UploadConfig`, and upload hooks | [File and media uploads](../04-collections/06-file-media-uploads.md) |
| Relation fields, populate, and relation envelopes | [Relationships](../04-collections/03-relationships.md) |
| Rich-text editor and server adapters | [Rich text](../04-collections/07-rich-text.md) |
| Document paths and slugifiers | [Document paths](../04-collections/05-document-paths.md) |
| Document trees | [Document trees](../04-collections/04-document-trees.md) |
| Search collection configuration | [Search configuration](../06-search/01-configuration.md) |
| Search query API | [Search API](../06-search/03-search-api.md) |
| `SearchProvider` implementation contract | [Search provider contract](../06-search/04-provider-contract.md) |
| Admin and API route mounts | [Routing and API](../05-reading-and-delivery/02-routing-and-api.md) |
| Interface and content locale configuration | [Internationalization](../08-internationalization/index.md) |
| Database adapter contract and boot composition | [Core composition](../03-architecture/02-core-composition.md) |
| Typed EAV storage and stored value shapes | [Document storage](../03-architecture/01-document-storage.md) |

## Reference conventions

- A property without `?` is required by TypeScript.
- “Conditional” means the property is optional in the type but required when another configured feature uses it.
- Defaults describe current runtime behavior when the property is omitted.
- `_`-prefixed options are internal or trusted-tooling escape hatches, even when TypeScript exposes them for hook re-entry.
- The implementation and exported TypeScript types remain authoritative when a reference and a locally installed package version differ.
