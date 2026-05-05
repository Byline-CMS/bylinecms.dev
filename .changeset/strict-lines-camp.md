---
"@byline/host-tanstack-start": minor
"@byline/richtext-lexical": minor
"@byline/db-postgres": minor
"@byline/client": minor
"@byline/core": minor
"@byline/cli": minor
"@byline/ui": minor
"@byline/admin": minor
"@byline/auth": minor
"@byline/storage-local": minor
"@byline/storage-s3": minor
---

- @byline/ui — consolidated the React entry surface. Standardised every consumer import on @byline/ui/react and removed the bare @byline/ui JS export from the exports map. The bare specifier now raises ERR_PACKAGE_PATH_NOT_EXPORTED; switch any external imports to @byline/ui/react. CSS subpath exports are unchanged.
- Admin / document history — added a "make current" restore action on the document history view, letting an admin promote any prior version back to the current revision from the history UI.
- @byline/db-postgres — fixed an EAV insert-boundary regression where datetime field values arriving as ISO strings (rather than Date instances) were rejected. The adapter now tolerates string-shaped date values and coerces them at the insert boundary.
