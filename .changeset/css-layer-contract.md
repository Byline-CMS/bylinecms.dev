---
"@byline/ui": minor
"@byline/richtext-lexical": minor
"@byline/admin": minor
"@byline/host-tanstack-start": minor
"@byline/ai": minor
"@byline/i18n": minor
---

Reserve the host overrides layer below Tailwind utilities in UI stylesheets.
Export a browser-safe layer statement and a PostCSS integration from
`@byline/ui/css-layers`. Keep normal UI declarations layered, including the
screen-reader utility, so direct host utilities can override the same property.
Align the editor's existing full layer prelude with the shared order.

Move CMS, host, editor and AI styles into the CMS sublayer of byline-components.
The primitive sublayer precedes it; host overrides and direct utilities remain
above both. Remove the old important checkbox-width workarounds.

This release changes CSS precedence in the CMS, including the document editor,
admin fields, host screens and portalled dialogs. Previously unlayered CMS
styles now participate in the shared layer contract. Direct Tailwind utilities
and layered host overrides can therefore win where they previously lost.

Before upgrading, move ordinary host CSS (including CSS modules and global
`a`, `button`, typography and form rules) into named layers. Unlayered host rules
now outrank CMS styles regardless of specificity. Put site components in
`components`, kit restyles in `overrides`, and scope public brand overrides away
from the CMS. Keep the early-head statement and PostCSS plugin together.
See [the UI kit migration guide](../docs/09-admin-ui/01-ui-kit.md#upgrading-existing-hosts).
Recheck public pages and CMS screens in both themes against a visual baseline.
The package versions remain synchronized by the repository's fixed release group;
this is a coordinated behavior change, not a patch-only styling correction.

Scope the example app's public typography overrides away from CMS routes,
including body-portalled dialogs. This prevents its public code font size from
overriding permission-key labels after CMS styles become layered.
