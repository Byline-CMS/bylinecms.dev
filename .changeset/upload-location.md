---
'@byline/core': minor
'@byline/storage-local': minor
'@byline/storage-s3': minor
---

`upload.location` — declarative storage-key scope per upload field.

An `image`/`file` field's `upload.location` (e.g. `'publications/covers'`, nested segments allowed) replaces the default `<collectionPath>/` storage-key scope, so multiple upload fields on one collection no longer mix their objects in a single directory. Providers keep their own entropy and filename sanitisation beneath the scope (`<location>/<uuid>-<filename>`), so collision behaviour is unchanged. Precedence: `beforeStore` `{ storagePath }` (verbatim, unchanged) → `location` → collection default; `{ filename }` hook overrides keep composing with the location. Plain data (isomorphic-safe), boot-validated (POSIX segments, no `..`, no stray slashes), and folded into the collection fingerprint. Hooks remain the tool for dynamic keys. Note: changing `location` later does not move previously stored objects.
