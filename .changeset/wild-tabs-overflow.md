---
"@byline/admin": minor
"@byline/host-tanstack-start": minor
"@byline/i18n": minor
---

Made the admin tab strip overflow-aware. A collection may declare any number of tabs while the column holding them is fixed, so the strip now scrolls horizontally and grows a menu listing every tab once the tabs exceed the column. Tabs keep their declared order and never move as a result of being selected.

Also closes the tablist's standing accessibility gaps: roving tabindex, arrow/Home/End traversal, and `aria-controls` wiring to the panels, which the form renderer and history view now mark up as tabpanels.

`AdminTabs` takes a new required `idBase` prop, used to derive the tab and panel ids; the exported `tabTriggerId` / `tabPanelId` helpers build the matching panel ids. Custom callers of `AdminTabs` must pass it and mark their panel up as a `tabpanel`.

The markup gained a scrolling viewport between the strip container and the tablist. `.byline-admin-tabs` is now the outer strip rather than the tablist itself, and the tablist has its own `.byline-admin-tablist` handle — stylesheets overriding `.byline-admin-tabs` for tab layout (`gap`, `display`) should move those rules to `.byline-admin-tablist`.
