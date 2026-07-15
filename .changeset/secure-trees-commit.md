---
'@byline/core': major
'@byline/client': major
'@byline/db-postgres': major
'@byline/host-tanstack-start': major
'@byline/cli': minor
'@byline/admin': minor
'@byline/i18n': patch
---

Make audited lifecycle transactions and tree reconciliation mandatory adapter capabilities, and return explicit committed delete outcomes when post-commit cleanup or hooks fail.

Harden read authorization with private client- and authority-bound `beforeRead` compilation, validate and freeze multi-segment route configuration at registration, centralize same-origin redirect validation, reject stale tree placements, preserve coded committed tree-hook failures over host transport, and make generated route migrations static, nested, atomic, and fail closed.

Generated example renderers now derive their Docs and Pages block union from collection output, dispatch known blocks exhaustively, and log and omit unsupported persisted block types instead of misrendering them through a fallback.

Route helper consumers should call `getSignInRoutePath()` without arguments. The deprecated legacy override validation now lives on `configureSignInRoutePath(override)`; configure new mounts through `routes.signIn`.
