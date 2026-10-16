# @byline/ui

Framework-independent React primitives for Byline CMS, including buttons,
inputs, overlays, icons, and drag-and-drop components. CMS field widgets and
document-editor forms belong to `@byline/admin`.

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

Byline's `dnd/` components and `react.ts` entry point have no upstream counterpart.

## Storybook

Storybook lets you inspect and interact with the UI primitives without starting
the CMS or a database. The stories are ported from the sibling UI kit and live
beside their components in `src/**/*.stories.tsx`.

After installing the workspace dependencies, run from the repository root:

```sh
pnpm storybook
```

Open <http://localhost:6007>. The preview includes the UI kit's reset, theme,
typography, local fonts, drawer provider, and toast provider. Use the toolbar
to switch between light and dark themes. The accessibility panel runs checks
against the selected story; documentation pages and controls are also available.

Build a static site with:

```sh
pnpm build-storybook
```

The output is `packages/ui/storybook-static/`, which is ignored by Git.
Both commands also work with `pnpm --filter @byline/ui` before the command name.
Port 6007 matches the sibling kit; stop its server before starting this one, or
run `pnpm --filter @byline/ui storybook --port 6008` to use a different port.

Configuration lives in `.storybook/main.ts` and `.storybook/preview.tsx`.
Static preview assets live in `public/`, with font licences beside the fonts.
The preview applies `.byline-ui` to the iframe body so portalled overlays inherit
the same scoped styles as the stories. Story layout uses inline styles and does
not require the web application's Tailwind configuration.

When adding a story, import components from their local source modules and
Storybook types from `@storybook/react-vite`. The package's `typecheck` command
checks stories and configuration; the library build excludes story modules.
Run the static build and inspect changed stories in the browser before merging.

## License

MPL-2.0
