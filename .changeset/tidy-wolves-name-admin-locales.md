---
'@byline/admin': minor
'@byline/cli': minor
'@byline/core': minor
'@byline/host-tanstack-start': minor
'@byline/i18n': minor
---

Renamed Byline's admin-language configuration and APIs to distinguish them from a host frontend's interface language. Configuration now uses `i18n.admin`; locale resolution and persistence APIs use `AdminLocale`; authored locale tuples use `adminLocales`, named default constants, and `nativeName` display values.
