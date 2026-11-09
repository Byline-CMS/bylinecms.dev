---
"@byline/core": patch
"@byline/db-postgres": patch
"@byline/db-mysql": patch
---

Changing a field's `localized` flag now preserves readable content and converts stored values on the next single-locale save. Newly localized fields retain their old shared value in other existing locales; newly shared fields use the document's source-locale value. Field filters and sorts follow the current declaration, and conversion saves preserve array and block item translations by `_id`.

This does not change ordinary locale copy-forward: removing or reordering items in an ordinary single-locale save still has the existing positional-translation limitation.
