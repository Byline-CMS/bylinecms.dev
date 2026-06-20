---
title: "Admin UI"
path: "admin-ui"
summary: "The building blocks of Byline's admin interface — the framework-agnostic UI Kit it is built from, and how the admin/editor configuration is registered into a host application without leaking into its public bundles."
---

# Admin UI

Byline's admin interface is assembled from a small, framework-agnostic component
kit and wired into a host application through a deliberately code-split
registration path. This section is for readers extending the admin surface or
integrating it into their own app.

- [UI Kit](./01-ui-kit.md) — `@byline/ui`, the framework-agnostic React
  primitives the admin is built from, and how to consume them in your own UI.
- [Client-config registration](./02-client-config-registration.md) — how the
  admin/editor configuration is registered on the client, why it is code-split
  away from public routes, and the trade-offs behind the current approach.
