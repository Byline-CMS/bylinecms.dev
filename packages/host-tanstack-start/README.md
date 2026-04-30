# @byline/host-tanstack-start

TanStack Start host adapter for Byline CMS — the framework-coupled glue
between Byline's framework-neutral packages and a TanStack Start
application. Server functions, request-scoped auth context, integration
glue for the field/admin service contracts, the admin shell (chrome +
per-area page containers), and route factories that turn each host
route file into a ~10-line re-export.

## Scope

This package is **not** a thin glue layer. It contains the entire admin
UI for TanStack Start hosts:

- `admin-shell/chrome/*` — app bar, menu drawer, breadcrumbs,
  route-error boundaries, layout primitives
- `admin-shell/{collections,admin-users,admin-roles,admin-permissions,admin-account}/*`
  — per-area page containers built on `@byline/ui` primitives
- `routes/*` — TanStack Router file-route factories that compose the
  shell + page containers
- `server-fns/*` — TanStack Start server functions wrapping every
  admin module command from `@byline/admin`
- `auth/*` — request-scoped `RequestContext` resolution from session
  cookies
- `integrations/*` — `bylineFieldServices`, `bylineAdminServices`
  bindings that adapt TanStack Start primitives onto the
  framework-neutral contracts in `@byline/ui` and `@byline/client`

Porting Byline to a different framework (Next.js, Remix, etc.) means
reimplementing the equivalents of `admin-shell/`, `routes/`, and
`server-fns/` against that framework's router and server-action
primitives. The framework-neutral packages (`@byline/core`,
`@byline/admin`, `@byline/client`, `@byline/auth`, `@byline/ui`) stay
identical across hosts.

## About Byline

This package is part of [Byline CMS](https://github.com/Byline-CMS/bylinecms.dev)
— a developer-friendly, open-source headless CMS with versioning, editorial
workflow, and content translation as first-class concerns.

For documentation, the full architecture overview, and getting started
instructions, see the main repository:
<https://github.com/Byline-CMS/bylinecms.dev>.

## License

MPL-2.0
