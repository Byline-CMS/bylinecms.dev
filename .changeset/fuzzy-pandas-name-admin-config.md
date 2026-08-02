---
'@byline/cli': minor
'@byline/core': minor
'@byline/host-tanstack-start': minor
---

Renamed the browser/SSR configuration contract from `ClientConfig` to `AdminConfig`, including its resolved type and registration/getter functions. Removed Byline's duplicated `serverURL` setting; hosts can now pass an optional client-safe `homeUrl` to `createSignInRoute()` when the sign-in page should link to the public site.
