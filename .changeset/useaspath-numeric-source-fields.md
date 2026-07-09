---
"@byline/core": minor
"@byline/admin": minor
---

`useAsPath` now accepts `integer` and `counter` source fields, and the admin
path-widget honours a replacement slugifier.

- **core:** allowed `integer` and `counter` fields as a collection's `useAsPath`
  source. `derivePath` already stringifies the source value before slugifying,
  so a numeric identity field (e.g. an allocator-assigned `counter` serial
  number) yields a clean numeric slug, and a replacement installation slugifier
  can branch on `collectionPath` to reshape it — for example zero-padding a
  serial to a fixed width. `float` / `decimal` remain excluded because their
  string form carries a `.`, which does not belong in a path segment.

- **core:** added `ClientConfig.slugifier` (the client-side twin of
  `ServerConfig.slugifier`), and carried the slugifier through the
  `getClientConfig()` SSR fallback so a server-rendered form derives the same
  path preview as the hydrated client.

- **admin:** the path-widget's live preview now uses the installation slugifier
  resolved from `getClientConfig()` (previously it always used the built-in
  `slugify`, so a custom slugifier's preview disagreed with what the server
  persisted — and "Regenerate" could overwrite a correct path). It also
  suppresses the source-derived preview and the "Regenerate" affordance when the
  `useAsPath` source is a server-assigned `counter` or a read-only field, whose
  value cannot be reproduced or changed through the form.

Additive and backward-compatible; installations that keep the default slugifier
need not set `ClientConfig.slugifier`.
