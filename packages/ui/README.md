# @byline/ui

Shared UI package for Byline CMS — the field-rendering primitives, form
context and patch-emitting field widgets, the `BylineFieldServicesProvider`
context, and other shared components consumed by the admin UI.

This package is part of [Byline CMS](https://github.com/Byline-CMS/bylinecms.dev)
— a developer-friendly, open-source headless CMS with versioning, editorial
workflow, and content translation as first-class concerns.

For documentation, the full architecture overview, and getting started
instructions, see the main repository:
<https://github.com/Byline-CMS/bylinecms.dev>.

## Relationship to `@infonomic/uikit`

The foundational surface of this package — the `components`, `icons`, `hooks`,
`lib`, `loaders`, `styles`, `utils`, and `widgets` directories, plus `uikit.ts`
— is shared with [`@infonomic/uikit`](https://github.com/infonomic). The two
kits are kept in step by **porting changes manually, in whichever direction a
change originates**: a change made here is ported upstream, a change made
upstream is ported here. Either copy may be edited directly; neither is the sole
source of truth.

Byline-specific code (`admin/`, `dnd/`, `fields/`, `forms/`, `services/`, and
`react.ts`) lives only in this package and has no upstream counterpart.

## License

MPL-2.0
