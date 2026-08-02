---
'@byline/cli': minor
'@byline/core': minor
'@byline/host-tanstack-start': minor
---

Renamed the browser/SSR configuration contract from `ClientConfig` to `AdminConfig`, including its resolved type and registration/getter functions. Removed Byline's duplicated `serverURL` setting; `createSignInRoute()` now defaults its Home link to `/`, and hosts can pass an explicit client-safe `homeUrl` when the public site uses another origin.
