# CSS layer contract: upstream verification

Date: 2026-10-25. Status: upstream implementation and local checks complete;
downstream browser checks remain pending at the owner's request. No packages
have been published and no site has been deployed.

## Change and compatibility boundary

Every stylesheet shipped by UI, admin, host-tanstack-start, richtext-lexical, AI
and i18n reserves the shared order. Kit component rules use
`byline-components.primitives`; CMS component rules use the later
`byline-components.cms`. Host overrides and ordinary Tailwind utilities sit above
both. The two checkbox-width `!important` workarounds are removed.

The independent `@byline/ui/css-layers` export supplies both the early-head
statement and the PostCSS plugin. Both integration points are present in the
example. The changeset marks all six affected packages as minor changes within
the fixed release group and describes the observable compatibility change.

Hosts must layer their ordinary CSS and scope public overrides away from the
CMS before upgrading. Unlayered host rules now beat layered CMS styles.
Existing host applications need their own sign-off for this change.
See [the migration guide](../docs/09-admin-ui/01-ui-kit.md#upgrading-existing-hosts).
The example's remaining public component CSS is not a full host-contract audit.

CodeMirror's runtime-injected layout/highlighting/theme styles are outside the
ordinary utility guarantee. Its selection-color important declaration has a
reason, a bounded source-test allowlist, and documented token-based customization.

## Local automated checks

- Production build of the example and its package dependencies passed. All 41
  emitted example CSS chunks preserve the canonical first-appearance order.
- UI source and built-artifact contract checks: 12 passed. These cover all six
  styled packages, emitted first-appearance order, primitive/CMS sublayer order,
  absence of direct parent-layer component declarations, runtime exceptions,
  the published helper and the example's public override scope.
- Minimum-runtime check uses Node 22.22.2, including native TypeScript import of
  the source helper. CI now explicitly runs `@byline/ui test:css-build` after
  `build:packages`; no claim is made that remote CI has run yet.
- Admin: 198 jsdom and 292 node tests passed. An existing form-layout test was
  converted from indentation-based substring matching to PostCSS selector checks.
- Lexical: 195 passed. Host adapter: 89 jsdom and 352 node tests passed.
  i18n: 50 passed. AI's existing seven skipped tests remain skipped.
- Typechecks passed for UI, admin, host, Lexical and the example app.
- Biome check of the repository passed after safe formatting; no unsafe lint
  rewrites were used. Documentation check: 76 documents, 805 links passed.
  Knip and the public-export audit passed. `git diff --check` passed.

## Manual browser comparisons

The retained production baseline on port 5673 was captured after the initial
UI order/helper work and before the CMS migration. The updated production build
runs on port 5773. This is a before/after baseline for the CMS migration, not a
pristine pre-task build. Browser interaction and computed-style comparisons were
manual tool-assisted checks, not an automated browser test suite.

Desktop comparisons covered light and dark themes:

- Dashboard and news collection list.
- News document details, checkbox and datetime fields, calendar popover and
  relation picker dialog.
- Lexical content, toolbar and inline-image modal. Embedded media must finish
  rendering before comparing geometry.
- Admin users, user details, role permissions and the user-role checkbox dialog.
- Sign-in using `reauthenticate=1`, so the authenticated session does not silently
  redirect the comparison back to the dashboard.
- Public home and getting-started documentation.

Mobile checks at 390px covered the dashboard and document fields in both themes.
The separate database-free fixture passed public/admin × light/dark × 1280/390px,
including a real CMS AdminRow, primitives, prose, a body portal, and `not-sr-only`.
It exercises spacing, width, background and typography utilities. Run it manually
with `pnpm --filter @byline/webapp preview:css-contract`.

A real regression appeared in the example: its public `code` font-size override
started winning against CMS permission-key labels. The example now derives a
public/admin context during rendering and scopes its typography override sheet
to public pages. Role and user-role label dimensions then matched the baseline.
A source guard prevents this public override leakage from returning.

One deliberate visual difference remains: the CMS's inherited dark text now
uses the kit's standard gray-50 rather than the public override's gray-100.
The sampled dark comparisons differ only in that color and the corresponding
currentColor value of zero-width borders. Checked geometry, font sizes and font
weights match. Light CMS and sampled public page comparisons match.

Screenshots and detailed computed-style records are retained locally in
`/tmp/byline-css-review`. They are not checked in because they contain local CMS
content and account details. Final editor comparisons use the `final-*` records;
earlier snapshots also preserve intermediate findings.

## Downstream checks and pending work

Infonomic and FORRU were copied to `/tmp/byline-css-consumers` with independent
APFS file clones. Their six installed styled Byline packages were replaced with
local release tarballs from `/tmp/byline-css-packages`. Both production builds
passed. FORRU's source/output CSS checks passed (10 tests); Infonomic's production
CSS checks passed (4 tests). The real repositories' dependencies and lockfiles
were not changed by these compatibility checks.

Both downstream browser checks remain pending, explicitly deferred by the owner
on 2026-10-25. FORRU's database was stopped; Infonomic's configured port was in use
by the separate Byline database. Earlier downstream CMS visual approval applies
to the old packages and does not constitute approval of this upstream release.
Infonomic's separate application-area authenticated checks remain deferred too.

Before adopting the published release, restore those local databases and compare
the two sites' public pages and CMS editors/dialogs against their saved baselines.
