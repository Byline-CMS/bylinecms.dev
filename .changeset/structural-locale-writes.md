---
"@byline/core": patch
---

Preserve translations by item identity when a single-locale save removes, inserts, replaces, or reorders array or block items, including nested containers. Structural saves rebuild the locale map instead of copying translations by their former positions; value-only edits keep the existing copy-forward path. The fix covers whole-document updates, editor patches, and singletons on both database adapters.

Preserve each surviving item's `_id` when submitting structural changes. Payloads without IDs retain positional matching. A block changed to a different `_type` no longer inherits translations from its former type.

Structural saves require a strict all-locale read. If reconstruction reports schema damage, the save is rejected without committing content or a revision, including on singletons that load leniently for editing. Repair the schema or migrate the incompatible rows before retrying.
