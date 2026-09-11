---
title: "Admin UI"
path: "admin-ui"
summary: "The building blocks of Byline's admin interface: the framework-agnostic UI Kit it is built from, and how the admin/editor configuration is registered into a host application without leaking into its public bundles."
---

# Admin UI

Companions:
- [Configuration](../01-getting-started/03-configuration.md) — the admin config file, isomorphic schema boundary, and public-bundle isolation rules.
- [Collections](../04-collections/index.md) — collection layouts, columns, preview URLs, and list-view extension points.
- [Configuration API](../10-api-reference/01-configuration.md) — the exact `AdminConfig` and registration contract.

Byline's admin interface is assembled from a small, framework-agnostic component
kit and wired into a host application through a deliberately code-split
registration path. This section is for readers extending the admin surface or
integrating it into their own app.

The [Singletons guide](../04-collections/09-singletons.md) explains how the admin dashboard,
editor, history view, and upload controls represent a one-document resource without list or
create routes.

- [UI Kit](./01-ui-kit.md) — `@byline/ui`, the framework-agnostic React
  primitives the admin is built from, and how to consume them in your own UI.
- [Admin-config registration](./02-admin-config-registration.md) — how the
  admin/editor configuration is registered on the client, why it is code-split
  away from public routes, and the trade-offs behind the current approach.
- [Collection groups](./03-collection-groups.md) — arranging dashboard
  collections into labelled groups, and filtering cards to the collections an
  administrator is allowed to read.
- [Richtext field capabilities](./04-richtext-capabilities.md) — how a Lexical
  field decides which structures it accepts, how that differs from which
  controls it shows, and what happens to stored content a field no longer
  supports.

## Concurrent editing and recovery

The editor loads a coherent current document together with its document-wide
revision. Every mutation uses that observation. If another editor, SDK client,
scheduler or structural operation commits first, Byline rejects the older
mutation before it changes persisted state.

The editor retains the local form and shows a persistent warning near the
document actions. All mutation controls for that editing session are blocked,
including Save, workflow status, path, advertised locales, schedules, duplicate,
delete, locale and tree actions. The editor can inspect or copy unsaved text,
then choose **Reload and discard my changes** to fetch a coherent current form.
Ordinary navigation continues to use the unsaved-change guard.

A confirmed database lock conflict uses a separate reload-required message. A
committed after-hook failure says that the write committed and must not be
submitted again. Missing revision payloads from an old browser fail closed and
also require reload. These outcomes are transported as typed errors; the admin
does not classify them by matching translated text or display raw database
messages.

Document-wide revisions intentionally make edits in separate content locales
conflict. All eight shipped admin-language bundles include the recovery copy;
adding another admin locale requires translating the complete
`documentConcurrency.*` key set before it can provide the same recovery flow.
Locale-grain merging and unsaved-work recovery across a reload are outside the
current interface.
