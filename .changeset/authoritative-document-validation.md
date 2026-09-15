---
'@byline/core': minor
'@byline/admin': minor
'@byline/host-tanstack-start': minor
'@byline/client': minor
'@byline/i18n': minor
---

Enforce the declared field contract on document writes, close a creation-status authorization gap, and fix a set of editor correctness defects found alongside them.

**Validation.** Core lifecycle services now validate the prepared document immediately before writing a content version, recursively through groups, array items and declared block variants, after hooks, normalization and counter assignment. The admin performs the same checks before submission, exempting condition-hidden fields and pending uploads. Field errors travel as `ERR_VALIDATION` with `details.reason: 'invalid_document_fields'` and an `issues` array of `{ field, message, kind }`, decoded safely by `getDocumentFieldValidationDetails`. Array and block paths use stable item identities, nested errors contribute to tab badges, and a server rejection preserves the editor's unsaved edits.

Restoring a historical version is exempt from that gate, because a historical version cannot be corrected through ordinary editing before it is restored. The restore still reports what today's rules object to, so the editor knows what to fix before its next save, which is validated in full. Duplication and locale copies keep the gate and now name their offending fields instead of showing a generic failure.

**Authorization.** Document creation rejects an undeclared initial status, and a non-default initial status requires `changeStatus`, plus `publish` when selecting published. The checks cover both the explicit option and the legacy `data.status` fallback, before and after preparation. Creating at the workflow's configured default remains authorized by `create` alone, including published-only workflows.

**Editor.** Superseded asynchronous field hooks can no longer overwrite newer input or newer errors; submission waits for active field changes and retains submit-time hook errors. A partially failed upload batch adopts its successes, so a retry transports only the files that failed. Form state moved to `useSyncExternalStore` with structural sharing, so a write between render and subscription is no longer missed. A parked system-field confirmation holds one payload that re-entry cannot replace. Built-in widgets honour `readOnly` consistently, including structural controls and the descendants of groups, arrays and blocks.

## Compatibility

Four changes can alter how an existing schema behaves.

- **`email` and `url` validation rules are now enforced.** They previously called Zod's `.describe()` rather than `.email()` / `.url()`, so they validated nothing. A collection declaring `validation: { rules: [{ type: 'email' }] }` over data that was never checked will start refusing saves.

- **Declared field requirements apply to every content save, including drafts.** An older document missing a field that has since become required stays readable, but must supply that field on its next content save. Restore is the exception above. If incomplete drafts are intentional for a collection, mark those fields `optional`.

- **A schema-author callback that throws is reported rather than propagated.** A `validate` or `condition` function, or a `custom` entry in `validation.rules`, that throws on data it did not anticipate now yields a `could not be validated` field error and blocks the save, where it previously escaped as an opaque error. The exception itself is logged server-side and never reaches the browser. A throwing `condition` leaves its field visible rather than taking the render down.

- **SDK callers passing an explicit `status` to `create()` now need the matching abilities.** Ordinary admin creation is unaffected: it uses the collection's configured default status.

`condition` remains a rendering hint that the lifecycle does not evaluate. Express a requirement that applies only in particular circumstances with `optional: true` plus a `validate` callback, which both sides enforce. See `docs/10-api-reference/03-fields.md`.
