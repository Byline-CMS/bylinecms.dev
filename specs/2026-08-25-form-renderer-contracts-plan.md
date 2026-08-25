# FormRenderer Contracts Implementation Plan

> **For implementers:** Work the tasks in order. Each task is an independent
> red → green → commit cycle with its own tests; do not start a task before its
> predecessor is committed. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `FormRenderer` fully capability-driven and fix its submit contract, so a
singleton host view can reuse it unchanged — and so the existing collection create view
stops rendering a Delete action for a document that does not exist.

**Architecture:** Four independent changes to the shared admin form layer. Each one stands
on its own merits as a fix or a generalisation of an existing contract; none of them
introduces a singleton concept, imports singleton code, or depends on singleton work
landing. Together they remove every form-layer blocker identified for singleton documents.

**Tech Stack:** React 19, TypeScript, Vitest (jsdom + node modes), Biome, pnpm/Turborepo.

**Spec:** `specs/2026-08-25-singleton-documents-design.md` — this plan implements the
form-layer prerequisites only. See "Relationship to the singleton spec" below.

## Global Constraints

- Biome formatting: 2-space indent, single quotes, no semicolons, 100-char line width,
  trailing commas (ES5).
- **Lint scope:** during a task, format only the files you touched:
  `pnpm exec biome check --write <paths>`. Do NOT run root `pnpm lint` mid-task — it writes
  across the whole workspace. Root `pnpm lint` runs once, in final verification, and its
  resulting diff must be inspected before committing.
- **Focused test runs:** pass the filter directly, with no `--` separator. A `--` causes the
  whole suite to run instead of the named file. Use:
  `pnpm --filter @byline/admin exec vitest run --mode=jsdom <filter>`
- Conventional commits, lowercase after the colon, past tense.
- Every commit MUST be made with `git commit -s`. The DCO `Signed-off-by` trailer is the
  ONLY permitted trailer — no `Co-Authored-By`, no AI attribution.
- jsdom-mode test files are named `*.test.tsx`; node-mode files are `*.test.node.ts`.
- Do not introduce `@testing-library/*`. This package tests React with
  `react-dom/client` + `act`, mocking `@byline/ui/react` with lightweight stubs. Follow
  `packages/admin/src/forms/path-widget.test.tsx`.
- Tests assert against the real English admin bundle via `I18nProvider` +
  `adminTranslations({ locales: ['en'] })`, never a stubbed `t`.

## Relationship to the singleton spec

The singleton design assumes the form layer can be reused unchanged. Verified against the
code, four contracts block that. Each is fixed here, ahead of and independent of the
singleton feature:

| Blocker | Task |
|---|---|
| Delete renders unconditionally; `onDelete` is ignored | Task 1 |
| `FormRenderer` demands the full `CollectionAdminConfig`, including list-only keys | Task 2 |
| Path widget cannot be suppressed; heading is hardcoded to create/edit wording | Task 3 |
| `onSubmit` is fire-and-forget; dirty state clears even when the save fails | Task 4 |

Task 1 is a live bug fix that is worth landing on its own regardless of singletons.

## Shared test harness

Tasks 1, 3, and 4 each create a jsdom test file. Every one of them begins with the same
mock block and harness. **Repeat it verbatim in each file** — do not extract it to a shared
helper, and do not import across test files.

```tsx
/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { act } from 'react'

import { adminTranslations } from '@byline/i18n/admin'
import { I18nProvider } from '@byline/i18n/react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Spread the REAL uikit and override only the three primitives that make
// assertions hard. A factory mock replaces the whole module, so anything not
// returned becomes `undefined` and React throws "Element type is invalid" on
// mount — FormRenderer alone pulls in Alert, Button, and ComboButton
// (`form-renderer.tsx:24`), and its field/presentation subtree pulls in more.
// `@byline/ui` ships a built `dist` plus a `development` source condition, so
// `importOriginal()` resolves without a prior build step.
vi.mock('@byline/ui/react', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  const Pass = ({ children }: any) => <div>{children}</div>
  const Modal: any = ({ children, isOpen }: any) => (isOpen ? <div>{children}</div> : null)
  Modal.Container = Pass
  Modal.Header = Pass
  Modal.Content = Pass
  Modal.Actions = Pass
  return {
    ...actual,
    Dropdown: {
      Root: Pass,
      Trigger: ({ children }: any) => <div data-testid="actions-trigger">{children}</div>,
      Portal: Pass,
      Content: Pass,
      Item: ({ children, onClick }: any) => (
        <div onClick={onClick} role="menuitem">
          {children}
        </div>
      ),
      Separator: () => <hr />,
    },
    Modal,
    // Overridden so `input[name=...]` is a stable selector for typing into
    // fields; every other uikit export comes through from `actual`.
    Input: ({ name, value, onChange }: any) => (
      <input name={name} value={value ?? ''} onChange={onChange} />
    ),
  }
})

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => {
    root.unmount()
  })
  container.remove()
})

const renderInProvider = (element: React.ReactNode) => {
  act(() => {
    root.render(
      <I18nProvider
        bundle={adminTranslations({ locales: ['en'] })}
        activeLocale="en"
        defaultLocale="en"
        localeDefinitions={[{ code: 'en', nativeName: 'English' }]}
      >
        {element}
      </I18nProvider>
    )
  })
}
```

---

### Task 1: Gate Delete on `onDelete` and hide the empty actions menu

`DocumentActions` types `onDelete` as optional and every other action gates on its callback
being supplied, but the Delete item and the separator above it render unconditionally
(`document-actions.tsx:373`). `FormRenderer` renders `DocumentActions` unconditionally, not
gated on `mode` (`form-renderer.tsx:681`), and the collection create view does not pass
`onDelete` — so **the create view shows a Delete item today**. Confirming it reaches
`if (onDelete) { onDelete() }` (`document-actions.tsx:215`) and silently does nothing.

`edit.tsx:673` is the only site in the admin shell that passes `onDelete`, so gating on it
removes the phantom item from create and changes nothing on edit.

**Files:**
- Modify: `packages/admin/src/forms/document-actions.tsx` (menu content ~296–390)
- Test: `packages/admin/src/forms/document-actions.test.tsx` (create)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: no signature change. `DocumentActions` keeps its existing props; only render
  behaviour changes. Later tasks and the singleton host rely on `onDelete === undefined`
  meaning "no Delete affordance".

- [ ] **Step 1: Write the failing test**

Create `packages/admin/src/forms/document-actions.test.tsx` starting with the shared
harness block above, then append:

```tsx
import { DocumentActions } from './document-actions'

describe('DocumentActions', () => {
  const render = (props: Record<string, unknown>) =>
    renderInProvider(<DocumentActions {...(props as any)} />)

  it('hides the Delete item when no onDelete handler is supplied', () => {
    render({})
    expect(container.textContent).not.toContain('Delete')
  })

  it('renders the Delete item when an onDelete handler is supplied', () => {
    render({ onDelete: async () => {} })
    expect(container.textContent).toContain('Delete')
  })

  it('renders no trigger at all when no actions are available', () => {
    render({})
    expect(container.querySelector('[data-testid="actions-trigger"]')).toBeNull()
  })

  it('renders the trigger when at least one action is available', () => {
    render({ onDuplicate: async () => {} })
    expect(container.querySelector('[data-testid="actions-trigger"]')).not.toBeNull()
  })
})
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `pnpm --filter @byline/admin exec vitest run --mode=jsdom document-actions`

Expected: cases 1 and 3 FAIL — `Delete` is present with no handler, and the trigger renders
with no available actions. Cases 2 and 4 pass already.

- [ ] **Step 3: Add the availability predicate**

In `packages/admin/src/forms/document-actions.tsx`, `schedulingActions` is declared at ~line
179 and populated by a series of `.push(...)` calls through ~line 210. The predicate reads
it, so it **must be declared after that block completes** — placing it next to
`deleteLocaleAvailable` (~line 168) would reference `schedulingActions` before
initialisation and throw at runtime.

Immediately after the final `schedulingActions.push(...)` block, add:

```tsx
  // Whether the ellipsis menu has anything to show. Every entry below is
  // conditional, so with no available action the trigger would open an empty
  // menu.
  const hasAnyAction =
    schedulingActions.length > 0 ||
    copyToLocaleAvailable ||
    deleteLocaleAvailable ||
    onDuplicate != null ||
    onDelete != null
```

- [ ] **Step 4: Gate the Delete item and its separator**

Wrap the Delete item and the separator that precedes it (currently unconditional, ~line
373):

```tsx
            {onDelete && (
              <>
                <DropdownComponent.Separator />
                <DropdownComponent.Item
                  onClick={() => {
                    setShowDeleteConfirm(true)
                  }}
                >
                  <div className={cx('byline-form-actions-item', styles.item)}>
                    <span className={cx('byline-form-actions-item-icon', styles['item-icon'])}>
                      <DeleteIcon width="16px" height="16px" />
                    </span>
                    <span className={cx('byline-form-actions-item-text', styles['item-text'])}>
                      <button
                        type="button"
                        className={cx('byline-form-actions-delete', styles.delete)}
                      >
                        {t('common.actions.delete')}
                      </button>
                    </span>
                  </div>
                </DropdownComponent.Item>
              </>
            )}
```

- [ ] **Step 5: Suppress the trigger when the menu would be empty**

The component returns a fragment whose first child is `<DropdownComponent.Root>` (~line 299)
and whose remaining children are the modals. Keep the modals mounted — they are driven by
state, not by the menu — and gate only the `Root`:

```tsx
      {hasAnyAction && (
        <DropdownComponent.Root>
          {/* ...existing Trigger / Portal / Content unchanged... */}
        </DropdownComponent.Root>
      )}
```

- [ ] **Step 6: Run the test and verify it passes**

Run: `pnpm --filter @byline/admin exec vitest run --mode=jsdom document-actions`

Expected: PASS, 4 tests.

- [ ] **Step 7: Verify no collection regression**

Run: `pnpm --filter @byline/admin test && pnpm typecheck`

Expected: PASS. `edit.tsx:673` passes `onDelete`, so the edit view is unchanged; the create
view loses an item that never worked.

- [ ] **Step 8: Format and commit**

```bash
pnpm exec biome check --write packages/admin/src/forms/document-actions.tsx packages/admin/src/forms/document-actions.test.tsx
git add packages/admin/src/forms/document-actions.tsx packages/admin/src/forms/document-actions.test.tsx
git commit -s -m "fix(admin): hid the delete action when no onDelete handler is supplied"
```

---

### Task 2: Extract the form-facing admin config base

`FormRenderer` and `useFormLayout` accept the whole `CollectionAdminConfig`
(`admin-types.ts:252`), which mixes form layout with list-only concerns — `columns`,
`defaultSort`, `defaultColumns`, `itemView`, `itemViewSort`, `listView`, and `listActions`.
(`showStats` is **not** among them; it lives on `CollectionDefinition:1324`.)

Across the entire form layer only **five** distinct keys are read: `fields` and `tabSets`
(`form-renderer.tsx:305,516`) and `tabSets`, `rows`, `groups`, `layout`
(`use-form-layout.ts:80–124`) — `tabSets` is read in both files.

Narrowing the parameter type to a shared base lets any resource kind whose admin config
carries those five keys reuse the renderer, and documents the real coupling.

**Note on red/green for this task:** the contract being added is purely type-level, and
Vitest does not typecheck. A `import type` assertion is erased at runtime, so a Vitest run
would pass whether or not `FormAdminConfig` exists. **`pnpm typecheck` is the red/green
gate here**, not the Vitest run. The test file still carries a runtime assertion so it is a
real, non-dead test that the suite executes.

**Files:**
- Modify: `packages/core/src/@types/admin-types.ts` (~236–352)
- Modify: `packages/admin/src/forms/use-form-layout.ts:92-95`
- Modify: `packages/admin/src/forms/form-renderer.tsx:~150` (the `adminConfig` prop type)
- Test: `packages/core/src/@types/form-admin-config.test.node.ts` (create)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `FormAdminConfig` exported from `@byline/core` (no generic parameter), with
  exactly:
  `fields?: Record<string, FieldAdminConfig>`, `tabSets?: TabSetDefinition[]`,
  `rows?: RowDefinition[]`, `groups?: GroupDefinition[]`, `layout?: LayoutDefinition`.
  `CollectionAdminConfig<T>` extends it. Task 3 and the singleton host both depend on this
  name and shape.

- [ ] **Step 1: Write the failing test**

Create `packages/core/src/@types/form-admin-config.test.node.ts`:

```ts
/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { describe, expect, it } from 'vitest'

import type { CollectionAdminConfig, FormAdminConfig } from './admin-types.js'

describe('FormAdminConfig', () => {
  it('accepts a config carrying only the form-facing keys', () => {
    const config: FormAdminConfig = {
      fields: {},
      tabSets: [],
      rows: [],
      groups: [],
      layout: { main: [] },
    }
    expect(Object.keys(config).sort()).toEqual(['fields', 'groups', 'layout', 'rows', 'tabSets'])
  })

  it('is satisfied by a full CollectionAdminConfig', () => {
    const collection: CollectionAdminConfig = { slug: 'pages', layout: { main: [] } }
    // Compile-time assertion: the collection config must be assignable to the
    // narrowed form base. `pnpm typecheck` is what enforces this, not Vitest.
    const asForm: FormAdminConfig = collection
    expect(asForm.layout).toEqual({ main: [] })
  })
})
```

- [ ] **Step 2: Run typecheck and verify it fails**

Run: `pnpm typecheck`

Expected: FAIL with `Module '"./admin-types.js"' has no exported member 'FormAdminConfig'`.

(Running Vitest at this point would misleadingly pass — the type import is erased. That is
why typecheck is the gate.)

- [ ] **Step 3: Introduce the base and re-parent the collection config**

In `packages/core/src/@types/admin-types.ts`, declare the base immediately above
`CollectionAdminConfig` (~line 246).

**Move the five members' existing JSDoc verbatim** — do not paraphrase or shorten it. The
current comments on `layout` and `fields` in particular carry contracts (the renderer's
synthesised default layout when `layout` is omitted; blockAdmin precedence for fields inside
blocks) that are not reconstructible from the property names. Cut and paste each comment
with its member. `itemView` and `itemViewSort` do NOT move — they stay on
`CollectionAdminConfig` and keep their comments there.

```ts
/**
 * The subset of admin configuration the shared form layer consumes.
 *
 * `FormRenderer` and `useFormLayout` read only these five keys. Narrowing the
 * form layer to this base keeps list-only configuration (columns, sorting,
 * item views, list actions) out of the form contract, and lets any admin
 * resource kind that declares form layout reuse the renderer unchanged.
 */
export interface FormAdminConfig {
  /* --- each member below keeps the exact JSDoc it had on CollectionAdminConfig --- */
  tabSets?: TabSetDefinition[]
  rows?: RowDefinition[]
  groups?: GroupDefinition[]
  layout?: LayoutDefinition
  fields?: Record<string, FieldAdminConfig>
}
```

Then change the collection config to extend it, deleting the five now-inherited members from
its body (currently `tabSets` 326, `rows` 329, `groups` 332, `layout` 340, `fields` 351):

```ts
export interface CollectionAdminConfig<T = any> extends FormAdminConfig {
  /** Must match the `path` of the corresponding `CollectionDefinition`. */
  slug: string
  // ...all remaining collection-only members unchanged...
}
```

Note: `FormAdminConfig` takes **no** generic parameter. `T` exists on
`CollectionAdminConfig` for `columns`, `defaultSort`, `itemView`, and `itemViewSort`, all of
which stay there — none of the five moved members uses it, so carrying a decorative type
parameter on the base would only invite callers to pass one that does nothing.

- [ ] **Step 4: Narrow the form-layer parameter types**

In `packages/admin/src/forms/use-form-layout.ts:92-95`:

```ts
export function useFormLayout(
  adminConfig: FormAdminConfig | undefined,
  fields: Field[]
): FormLayout {
```

Update its type import from `@byline/core` to bring in `FormAdminConfig` instead of
`CollectionAdminConfig`.

In `packages/admin/src/forms/form-renderer.tsx`, change the prop declaration (currently
`adminConfig?: CollectionAdminConfig`, ~line 150):

```ts
  adminConfig?: FormAdminConfig
```

and update the type import at the top of the file (~line 13–20) accordingly.

- [ ] **Step 5: Run typecheck and verify it passes**

Run: `pnpm typecheck`

Expected: PASS. Existing collection views pass a full `CollectionAdminConfig`, which
structurally satisfies the narrowed parameter, so no call site changes.

- [ ] **Step 6: Run the test suites**

Run: `pnpm --filter @byline/core test && pnpm --filter @byline/admin test`

Expected: PASS.

- [ ] **Step 7: Format and commit**

```bash
pnpm exec biome check --write packages/core/src/@types/admin-types.ts packages/core/src/@types/form-admin-config.test.node.ts packages/admin/src/forms/use-form-layout.ts packages/admin/src/forms/form-renderer.tsx
git add packages/core/src/@types/admin-types.ts packages/core/src/@types/form-admin-config.test.node.ts packages/admin/src/forms/use-form-layout.ts packages/admin/src/forms/form-renderer.tsx
git commit -s -m "refactor(core): extracted FormAdminConfig as the form-facing admin config base"
```

---

### Task 3: Add explicit `showPath` and `heading` overrides

The path widget renders when `useAsPath` is set **or** `initialData.path` is a non-empty
string (`form-renderer.tsx:739`). A resource with no `useAsPath` therefore still gets the
widget whenever the envelope happens to carry a path, which makes suppression an implicit
consequence of the read shape rather than a stated capability.

Separately, the heading is derived purely from `mode` (`form-renderer.tsx:339-347`): an
unmaterialised resource renders "Create <label>" even when the slot conceptually always
existed and the editor is simply filling it in.

**Files:**
- Modify: `packages/admin/src/forms/form-renderer.tsx` (props ~82–180; heading ~339–347;
  sidebar ~739)
- Test: `packages/admin/src/forms/form-renderer-capabilities.test.tsx` (create)

**Interfaces:**
- Consumes: `FormAdminConfig` from Task 2.
- Produces: two new optional `FormRendererProps` members —
  `showPath?: boolean` (default `true`, preserving today's behaviour) and
  `heading?: string` (when set, used verbatim in place of the create/edit wording).
  The singleton host view depends on both.

- [ ] **Step 1: Write the failing test**

Create `packages/admin/src/forms/form-renderer-capabilities.test.tsx` starting with the
shared harness block, then append:

```tsx
import { FormRenderer } from './form-renderer'

const baseProps = {
  mode: 'edit' as const,
  fields: [{ name: 'title', label: 'Title', type: 'text' as const }],
  onSubmit: () => {},
  onCancel: () => {},
  collectionPath: 'pages',
  initialData: { id: 'doc-1', path: 'about-us', fields: { title: 'About' } },
}

describe('FormRenderer capabilities', () => {
  const render = (props: Record<string, unknown>) =>
    renderInProvider(<FormRenderer {...(props as any)} />)

  it('renders the path widget by default when initialData carries a path', () => {
    render(baseProps)
    // `.byline-form-path` is PathWidget's documented stable override handle.
    // The slug lives in an input value, which is NOT part of textContent, so
    // assert on the element and its value rather than on rendered text.
    const widget = container.querySelector('.byline-form-path')
    expect(widget).not.toBeNull()
    const input = container.querySelector<HTMLInputElement>('input[name="__systemPath__"]')
    expect(input?.value).toBe('about-us')
  })

  it('suppresses the path widget when showPath is false', () => {
    render({ ...baseProps, showPath: false })
    expect(container.querySelector('.byline-form-path')).toBeNull()
    expect(container.querySelector('input[name="__systemPath__"]')).toBeNull()
  })

  it('uses the heading override verbatim instead of create/edit wording', () => {
    render({ ...baseProps, mode: 'create' as const, headingLabel: 'Thing', heading: 'Site settings' })
    const heading = container.querySelector('h1, h2, h3')
    // Exact match: asserting `toContain('Site settings')` would also pass on
    // "Create Site settings", so it would not detect the override failing.
    expect(heading?.textContent?.trim()).toBe('Site settings')
  })

  it('falls back to create wording when no heading override is given', () => {
    render({ ...baseProps, mode: 'create' as const, headingLabel: 'Thing' })
    const heading = container.querySelector('h1, h2, h3')
    // `forms.heading.createLabel` is "Create {label}" (en.json:459). Assert the
    // exact string: `toContain('Thing')` would also pass on "Edit Thing", so it
    // would not pin create-vs-edit wording at all.
    expect(heading?.textContent?.trim()).toBe('Create Thing')
  })
})
```

If the heading is not rendered inside an `h1`/`h2`/`h3`, locate its element in
`form-renderer.tsx` and use its stable `byline-*` class as the selector instead. Do not fall
back to asserting on `container.textContent`.

- [ ] **Step 2: Run the test and verify it fails**

Run: `pnpm --filter @byline/admin exec vitest run --mode=jsdom form-renderer-capabilities`

Expected: cases 2 and 3 FAIL — `showPath` and `heading` are not props yet, so the widget
still renders and the heading still reads "Create Thing". Cases 1 and 4 pass already.

- [ ] **Step 3: Declare the props**

In `FormRendererProps` (`form-renderer.tsx:82`), add:

```ts
  /**
   * Whether the system path widget may render in the sidebar. Defaults to
   * `true`, which preserves the historical behaviour of showing the widget
   * whenever `useAsPath` is declared or the document envelope carries a
   * `path`. Set `false` for a resource whose path is internal metadata and
   * must never be presented or edited.
   */
  showPath?: boolean
  /**
   * Explicit form heading, used verbatim. Overrides both `useAsTitle`'s live
   * value and the create/edit wording derived from `mode` — for a resource
   * whose identity does not change when it is first materialised.
   */
  heading?: string
```

Destructure both in `FormContent` alongside the existing props (~line 184), defaulting
`showPath` to `true`.

- [ ] **Step 4: Apply them**

Heading (`form-renderer.tsx:339-347`) — the override wins over the live title. The local is
currently named `heading`, which now collides with the prop; rename the local to
`computedHeading` and update its single render site:

```tsx
  const computedHeading =
    heading ||
    liveTitle ||
    (headingLabel
      ? mode === 'create'
        ? t('forms.heading.createLabel', { label: headingLabel })
        : t('forms.heading.editLabel', { label: headingLabel })
      : mode === 'create'
        ? t('forms.heading.create')
        : t('forms.heading.edit'))
```

Sidebar (`form-renderer.tsx:739`):

```tsx
          {showPath &&
            (useAsPath ||
              (typeof initialData?.path === 'string' && initialData.path.length > 0)) && (
              <PathWidget
                /* ...unchanged... */
              />
            )}
```

- [ ] **Step 5: Run the test and verify it passes**

Run: `pnpm --filter @byline/admin exec vitest run --mode=jsdom form-renderer-capabilities`

Expected: PASS, 4 tests.

- [ ] **Step 6: Run the full suite and typecheck**

Run: `pnpm --filter @byline/admin test && pnpm typecheck`

Expected: PASS. Both props are optional with behaviour-preserving defaults, so no existing
caller changes.

- [ ] **Step 7: Format and commit**

```bash
pnpm exec biome check --write packages/admin/src/forms/form-renderer.tsx packages/admin/src/forms/form-renderer-capabilities.test.tsx
git add packages/admin/src/forms/form-renderer.tsx packages/admin/src/forms/form-renderer-capabilities.test.tsx
git commit -s -m "feat(admin): added showPath and heading overrides to FormRenderer"
```

---

### Task 4: Make submission awaitable and propagate host failures

`submitPayload` invokes `onSubmit` and calls `resetHasChanges()` synchronously
(`form-renderer.tsx:383`), with a comment acknowledging the reset is optimistic. A failed
save therefore leaves the form reporting clean, and the navigation guard stops blocking.

Awaiting `onSubmit` is **not sufficient on its own**: both collection handlers catch the
error, log it, raise a toast, and resolve normally (`create.tsx:87`, `edit.tsx:611`). An
awaited call would still always observe success. The contract has to change on both sides.

**Contract:** `FormRenderer` awaits `onSubmit`. Resolution means success and commits the
clean baseline. Rejection preserves dirty state. Host handlers may still surface their own
toast, but MUST rethrow afterwards.

**Awaiting opens a duplicate-save window that the synchronous version did not have.** Today
`resetHasChanges()` runs the instant Save is pressed, so `hasChanges` flips false and the
Save button disables itself immediately (`form-renderer.tsx:618`). Once the handler is
awaited, the form stays dirty for the whole round trip — Save remains enabled, and a second
click submits again while the first request is still in flight. The change therefore has to
add an explicit in-flight guard; it is not optional hardening.

This changes behaviour for every existing collection form — after a failed save the form now
stays dirty and the navigation guard blocks navigation it previously allowed. That is the
correct behaviour and it is a visible change, which is why it lands as its own commit rather
than inside feature work.

**Files:**
- Modify: `packages/admin/src/forms/form-renderer.tsx:~380-392` (`submitPayload`) and the
  `onSubmit` prop type (~line 85)
- Modify: `packages/host-tanstack-start/src/admin-shell/collections/create.tsx:~87`
- Modify: `packages/host-tanstack-start/src/admin-shell/collections/edit.tsx:~611`
- Test: `packages/admin/src/forms/form-renderer-submit.test.tsx` (create)

**Interfaces:**
- Consumes: nothing from Tasks 1–3.
- Produces: `onSubmit: (data: any) => void | Promise<void>` on `FormRendererProps`. A
  rejected promise leaves dirty state intact. The singleton host view relies on this to keep
  an unmaterialised first save recoverable.

- [ ] **Step 1: Write the failing test**

The dirty signal is already user-visible, so no test-only hook is needed: the dismiss button
reads "Close" when `hasChanges === false` and "Cancel" otherwise (`form-renderer.tsx:612`),
and the Save button is `disabled` when clean (`form-renderer.tsx:618`).

**A freshly rendered form is clean**, so the test MUST type into a field before submitting —
otherwise Save is disabled, the form never submits, and both assertions are vacuous.

Create `packages/admin/src/forms/form-renderer-submit.test.tsx` starting with the shared
harness block, then append:

```tsx
import { FormRenderer } from './form-renderer'

const fields = [{ name: 'title', label: 'Title', type: 'text' as const }]

// React attaches a value tracker to inputs it renders, so assigning `.value`
// directly is swallowed. Go through the native setter, then dispatch, so
// React's onChange actually fires and the form becomes dirty.
const typeIntoTitle = (value: string) => {
  const input = container.querySelector<HTMLInputElement>('input[name="title"]')
  if (input == null) throw new Error('title input not found')
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    'value'
  )?.set
  act(() => {
    setter?.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

const submitForm = () => {
  const form = container.querySelector('form')
  if (form == null) throw new Error('form not found')
  act(() => {
    form.requestSubmit()
  })
}

describe('FormRenderer submit contract', () => {
  const render = (props: Record<string, unknown>) =>
    renderInProvider(<FormRenderer {...(props as any)} />)

  const baseProps = {
    mode: 'create' as const,
    fields,
    onCancel: () => {},
    collectionPath: 'pages',
  }

  it('becomes dirty once a field is edited', () => {
    render({ ...baseProps, onSubmit: async () => {} })
    expect(container.textContent).toContain('Close')
    typeIntoTitle('Hello')
    expect(container.textContent).toContain('Cancel')
  })

  it('clears dirty state when onSubmit resolves', async () => {
    const onSubmit = vi.fn(async () => {})
    render({ ...baseProps, onSubmit })
    typeIntoTitle('Hello')
    submitForm()
    await act(async () => {})
    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(container.textContent).toContain('Close')
  })

  it('preserves dirty state when onSubmit rejects', async () => {
    const onSubmit = vi.fn(async () => {
      throw new Error('save failed')
    })
    render({ ...baseProps, onSubmit })
    typeIntoTitle('Hello')
    submitForm()
    await act(async () => {})
    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(container.textContent).toContain('Cancel')
  })

  it('ignores a second submit while the first is still in flight', async () => {
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const onSubmit = vi.fn(async () => {
      await gate
    })
    render({ ...baseProps, onSubmit })
    typeIntoTitle('Hello')
    submitForm()
    submitForm()
    expect(onSubmit).toHaveBeenCalledTimes(1)
    await act(async () => {
      release()
    })
    expect(onSubmit).toHaveBeenCalledTimes(1)
  })
})
```

The first case is a guard: if it fails, the harness is not making the form dirty and the
other two cases prove nothing. Fix it before proceeding.

- [ ] **Step 2: Run the test and verify it fails**

Run: `pnpm --filter @byline/admin exec vitest run --mode=jsdom form-renderer-submit`

Expected: case 3 FAILS — dirty state is cleared regardless of outcome, so the button reads
"Close". Expect an unhandled-rejection warning too; that is the defect. Case 4 also FAILS:
without an in-flight guard the second `submitForm()` calls the handler again. Cases 1 and 2
pass.

- [ ] **Step 3: Make the renderer await**

Widen the prop type (`form-renderer.tsx:85`):

```ts
  onSubmit: (data: any) => void | Promise<void>
```

Replace `submitPayload` (`form-renderer.tsx:381-391`):

```tsx
  // Await the host handler. Resolution means the save succeeded and the clean
  // baseline can be committed; rejection preserves dirty state so the editor
  // does not lose work and the navigation guard keeps blocking. Host handlers
  // that surface their own toast MUST rethrow afterwards.
  // Re-entry guard lives in a ref so the callback identity does not change
  // mid-flight; the mirrored state drives the Save button's disabled prop.
  const submittingRef = useRef(false)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const submitPayload = useCallback(
    async (payload: SystemFieldsSubmitPayload) => {
      if (typeof onSubmit !== 'function') return
      if (submittingRef.current) return
      submittingRef.current = true
      setIsSubmitting(true)
      try {
        await onSubmit(payload)
        resetHasChanges()
      } catch {
        // Intentionally swallowed here — the host has already reported the
        // failure to the user. Dirty state is preserved by not resetting.
      } finally {
        submittingRef.current = false
        setIsSubmitting(false)
      }
    },
    [onSubmit, resetHasChanges]
  )
```

Add `useRef` to the existing `react` import if it is not already present.

Then disable Save while a submission is in flight (`form-renderer.tsx:618`):

```tsx
            disabled={hasChanges === false || isUploading || isSubmitting}
```

Leave the button's **label** alone. There is no general `forms.actions.saving` key — only
`scheduledPublication.form.saving` (`en.json:598`) — and adding one would mean touching every
locale bundle and risking the i18n boot validator's key-drift warning. Disabling without
relabelling is the minimal correct change.

Both call sites of `submitPayload` (the direct path and the pending-system-fields
confirmation path) now return promises. Mark their enclosing handlers `async`, and `void`
the call where the return value is unused so no floating-promise lint fires.

- [ ] **Step 4: Run the test and verify it passes**

Run: `pnpm --filter @byline/admin exec vitest run --mode=jsdom form-renderer-submit`

Expected: PASS, 4 tests.

- [ ] **Step 5: Rethrow from the collection create handler**

In `packages/host-tanstack-start/src/admin-shell/collections/create.tsx`, at the end of the
`catch (err)` block that begins at line 87 — after `toastManager.add({...})`:

```ts
      // Rethrow so FormRenderer keeps the form dirty. The toast above has
      // already told the editor what went wrong.
      throw err
```

Ensure the enclosing handler is `async` and that its promise is returned to `onSubmit`.

- [ ] **Step 6: Rethrow from the collection edit handler**

Apply the identical change in
`packages/host-tanstack-start/src/admin-shell/collections/edit.tsx`, at the end of the
`catch (err)` block that begins at line 611.

- [ ] **Step 7: Run the full suites and typecheck**

Run: `pnpm --filter @byline/admin test && pnpm --filter @byline/host-tanstack-start test && pnpm typecheck`

Expected: PASS.

- [ ] **Step 8: Verify the navigation guard in the real app**

Run `pnpm dev`, open a collection edit form, change a field, and save with the API stopped
(or force a server error). Confirm the form still reports unsaved changes and that navigating
away prompts. Then save successfully and confirm the prompt is gone.

- [ ] **Step 9: Format and commit**

```bash
pnpm exec biome check --write packages/admin/src/forms/form-renderer.tsx packages/admin/src/forms/form-renderer-submit.test.tsx packages/host-tanstack-start/src/admin-shell/collections/create.tsx packages/host-tanstack-start/src/admin-shell/collections/edit.tsx
git add packages/admin/src/forms/form-renderer.tsx packages/admin/src/forms/form-renderer-submit.test.tsx packages/host-tanstack-start/src/admin-shell/collections/create.tsx packages/host-tanstack-start/src/admin-shell/collections/edit.tsx
git commit -s -m "fix(admin): preserved dirty state when a form submission fails"
```

---

## Out of scope for this plan

These belong to later singleton plans and MUST NOT be started here:

- Kind-aware ability-key construction (`assertActorCanPerform` / `collectionAbilityKey`).
  Lifecycle code should pass a resource descriptor rather than reconstruct namespace keys
  from a path. Blocks singleton authorization and `field-upload.ts:288`.
- Upload authorization for singletons — requiring `singletons.<path>.update` and prohibiting
  the create-document branch.
- `SingletonView`, the stable singleton route, and dashboard card wiring.
- `SingletonDefinition`, `defineSingleton()`, the `byline_singleton_documents` mapping table,
  and the `UNIQUE(collection_id, id)` supporting key.

## Final verification

Run once, after all four tasks are committed:

- [ ] `pnpm lint` — then inspect the resulting diff, since this writes across the workspace:
      `git diff --stat`. Unrelated reformatting should be reverted, not committed.
- [ ] `git diff --check` — no whitespace errors
- [ ] `pnpm typecheck` clean
- [ ] `pnpm test` green
- [ ] Collection create view shows no Delete item
- [ ] Collection edit view still shows Delete and it still works
- [ ] A failed save leaves the form dirty and the navigation guard active
- [ ] Every commit carries a DCO `Signed-off-by` trailer and no others:
      `git log --format='%H %(trailers)' origin/develop..HEAD`
