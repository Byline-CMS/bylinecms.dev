---
'@byline/admin': major
'@byline/cli': major
'@byline/core': major
'@byline/host-tanstack-start': major
'@byline/i18n': major
---

Renamed Byline's admin-language configuration and APIs to distinguish them from a host frontend's interface language. Configuration now uses `i18n.admin`; locale resolution and persistence APIs use `AdminLocale`; authored locale tuples use `adminLocales`, named default constants, and `nativeName` display values.
