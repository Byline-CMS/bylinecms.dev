---
"@byline/core": patch
"@byline/db-postgres": patch
"@byline/db-mysql": patch
"@byline/host-tanstack-start": patch
"@byline/i18n": patch
---

Reject duplicate array and block item IDs within each container on ordinary content writes. Field validation identifies the container and conflicting item positions. IDs may repeat in separate containers; missing IDs retain positional matching, and historical restore keeps its validation exemption.

Explain blocked saves when stored content cannot be reconstructed during a collection mutation read or an all-locale merge. This includes collection value-only saves and damaged singletons that can still be opened for editing. The lifecycle returns a structured repair-required validation error; the admin editor asks for a compatible schema or content migration and retains unsaved edits. Reconstruction diagnostics stay on the server, and unrelated database failures retain their original classification. The strict save behavior is unchanged.
