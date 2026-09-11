---
"@byline/richtext-lexical": major
"@byline/i18n": minor
---

**`@byline/richtext-lexical`** made a richtext field's resolved editor decide which structures it accepts, not merely which controls it offers.

**API changes.** `EditorSettings.options` is replaced by `mode`, `markdownShortcuts`, `controls` and `debug`, with no alias — every flag under `controls` hides an affordance and none restricts content. The `Nodes` export is renamed `READABLE_NODES` and is no longer a registration list; it is the vocabulary the normalizer and capability manifest work from. A new runtime-free `@byline/richtext-lexical/scan` subpath carries the pre-upgrade scanning API.

**Content behaviour.** Removing an extension now removes its node registration as well as its controls, so a field configured without headings no longer accepts one by paste, by Markdown, or from storage. Existing documents are unaffected on disk: content a field no longer supports is adapted when the editor loads it — a heading becomes a paragraph, text preserved — and the reader is told. Content with no safe conversion, such as an image or an embed, is never restructured; that field opens read-only instead. **Stored values do not change until that field is edited and saved.** SDK reads, Markdown export and every other consumer continue to see documents exactly as written.

**Before upgrading**, generate a capability manifest (`pnpm byline:richtext-manifest` — no browser required) and scan stored documents against it. The scan is read-only and exits non-zero if any value would open read-only or any field's capabilities cannot be measured. See [Richtext field capabilities](https://github.com/Byline-CMS/bylinecms.dev/blob/main/docs/09-admin-ui/04-richtext-capabilities.md).

**`@byline/i18n`** added the admin-bundle keys for the editor's content-adaptation notices across all eight locales.
