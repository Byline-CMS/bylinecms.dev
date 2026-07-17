---
'@byline/core': minor
'@byline/storage-local': minor
'@byline/storage-s3': minor
---

Friendly upload storage keys + configurable filename slugifier.

New uploads are stored as `<location|collection>/<slugified-base>-<suffix>.<ext>` (e.g. `events/meeting-agenda-4fa35g.pdf`) instead of `<collection>/<uuid>-<filename>` — the filename leads and the entropy rides as a short 6-char base36 suffix before the extension, so downloads, object-store consoles, and logs show human-readable names. Providers verify the candidate key is free (`exists()`) and retry with a fresh suffix on collision, falling back to a full-entropy UUID suffix after three straight collisions — collision safety is preserved, not traded away. The base name is slugified by a new installation-wide `ServerConfig.uploads.filenameSlugifier` (the upload parallel of the path `slugifier`; default `slugifyFilename` exported from `@byline/core`), which receives the base name plus `{ collectionPath, fieldName, mimeType }` context. `beforeStore` hooks are unaffected: `{ filename }` overrides keep composing, `{ storagePath }` stays verbatim. Existing stored objects keep their recorded paths; the new layout applies to new uploads only.
