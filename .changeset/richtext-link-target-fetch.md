---
"@byline/admin": patch
"@byline/ai": patch
"@byline/auth": patch
"@byline/cli": patch
"@byline/client": patch
"@byline/core": patch
"@byline/db-postgres": patch
"@byline/host-tanstack-start": patch
"@byline/richtext-lexical": patch
"@byline/storage-local": patch
"@byline/storage-s3": patch
"@byline/ui": patch
---

fix(richtext-lexical): batched the link / inline-image populate fetch through `getDocumentsByDocumentIds` instead of `client.collection(...).find({ where: { id: { $in } } })`. `parseWhere` has no `id` handler, so the previous shape silently dropped the filter and returned arbitrary docs ordered by `created_at desc` — link embeds against any collection with more than one published doc could resolve to the wrong target (or trip the "internal link target not found" branch). Now mirrors the same adapter primitive relation populate already uses.
