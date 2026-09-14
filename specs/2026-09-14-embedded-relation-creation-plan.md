# Embedded Relationship Creation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an editor create a related document — media first — from inside the
relationship picker, using the ordinary collection form and the ordinary create
transport, without saving or disturbing the parent document.

**Architecture:** The relationship picker gains a second view inside its existing
modal. That view mounts the ordinary collection form under its own `FormProvider`
in create mode, composing the shared submission and layout pieces extracted by
issue #94 while omitting page-level document controls. A confirmed creation is
recorded as a *receipt* (`documentId` + `collectionId` + outcome) before any
display read, and the receipt plus its presentation state is handed to the parent
relation field, which owns it after the picker closes. Nothing about field data,
patches, paths, or locale policy changes on the server.

**Tech Stack:** TypeScript, React, TanStack Start / Router, Vitest (jsdom + node
modes), Biome, pnpm + Turborepo.

**Spec:** `specs/2026-09-14-embedded-relation-creation-spec.md` — read it in full
before Task 1. The plan argues from the spec; where they disagree, the spec wins.

**Branches:** this plan ships as **two independent branches**, in order.

| Part | Branch | Tasks | Checkpoints | Merges |
|---|---|---|---|---|
| I — Form refactor and concurrent-form correctness | `refactor/forms` | 1–7 | 1–3 | to `develop` **before** Part II starts |
| II — Embedded relationship creation | `feature/relation-create-new` | 8–22 | 4–7 | to `develop` when complete |

Part I stands entirely on its own: it is #94's extraction work plus a latent
accessibility fix, both of which improve the existing full-page editor and are worth
merging whether or not the feature is ever built. Part I carries **no open product or
API decisions**. Part II branches from `develop` only after Part I has merged.

**Related issue:** [#94 refactor(admin): split FormContent into focused workflows](https://github.com/Byline-CMS/bylinecms.dev/issues/94).
Phase 1 of this plan *is* the subset of #94 this feature depends on. Those tasks
must stay behaviour-preserving and are reviewable as #94 work in their own right.
Phase 1 must not import anything from Phases 3–6 or reference embedded creation.

---

## Global Constraints

- **Formatting is Biome, not Prettier/ESLint.** 2-space indent, single quotes,
  **no semicolons**, LF endings, 100-character line width, ES5 trailing commas.
  Run `pnpm lint` (which auto-fixes, and writes files) before every commit.
- **Import ordering is enforced by Biome:** Node builtins → URLs → React →
  TanStack → packages → local, with blank lines between groups.
- **Conventional commits, and `git commit -s` every time.** The DCO
  `Signed-off-by` trailer is the **only** permitted trailer. No `Co-Authored-By`,
  no AI attribution, no other trailers. Lowercase after the colon, past tense.
- **Never name client projects, clients, or their domains** in this repository.
- **Every new source file** starts with the MPL-2.0 header block copied verbatim
  from a sibling file in the same directory.
- **Test file naming:** `*.test.node.ts` for node mode, `*.test.tsx` for jsdom.
  Admin and host `test` scripts run both modes; a targeted component run needs
  `pnpm vitest run --mode=jsdom <file>` explicitly.
- **jsdom tests in `@byline/admin` use `react-dom/client` `createRoot` + `act`**,
  not React Testing Library, and mock `@byline/ui/react` for `Modal`. Copy the
  harness from `packages/admin/src/forms/form-renderer-submit.test.tsx`.
- **`@byline/admin` must never import TanStack routes or server functions.** Host
  capabilities reach it by injection only.
- **`@byline/core` is React-free.**
- **Field paths, field names, patch paths, and schema identifiers are frozen.**
  Only DOM ids and the attributes that reference them may be scoped (Phase 2).
- **Documents are created in the installation's default content locale.**
  `packages/core/src/services/document-lifecycle/create.ts:88` rejects any other
  `params.locale`. Never send the parent editor's active locale.
- **New translation keys land in all eight bundled locales** — `en`, `fr`, `de`,
  `es`, `it`, `ko`, `th`, `zh-CN`. `packages/i18n/src/admin/index.test.node.ts`
  enforces parity and will fail the build otherwise.
- **There is no automated end-to-end suite.** `apps/webapp/e2e/*.spec.ts` and the
  `test:e2e` scripts exist in the tree but are **not** part of the workflow and are not
  referenced by CI. Do not add Playwright specs and do not treat `pnpm test:e2e` as a
  gate. Browser verification in this plan is performed **by hand, or driven through the
  Claude-in-Chrome browser extension**, against a running dev server — each browser
  check below is written as a scenario plus a console snippet that prints PASS/FAIL, so
  it works either way.
- **Static gates, in this order:** `pnpm byline:generate:check`, `pnpm lint`,
  `pnpm typecheck`, `pnpm knip`. Knip runs on pre-push — run it before you push,
  not after.

---

## Review checkpoints

Work stops at each checkpoint below and a review is requested from **GPT-6 Astra**
before dependent work begins. Independent work may continue in parallel where it does
not touch the changes under review.

Checkpoints are **review boundaries, not commit boundaries.** Keep commits small and
coherent; do not bundle a whole phase into one commit to line up with a checkpoint.

The six findings from the second plan review are already incorporated into the task
text below (`status: 'any'`, the aligned outcome chain, controlled tab state and the
sidebar slot, `onBeforeBusy`, content-locale propagation, and the strengthened browser
assertions). Nothing from that review remains outstanding at the plan level — but it is
still implementation work, and each checkpoint verifies it landed.

| # | Part | Timing | Review scope |
|---|---|---|---|
| 1 | I | After Task 1 | Synchronous re-entry protection across validation through submission; phase transitions; system-field confirmation; dirty-state handling; upload sequencing; mutation blocking; full-page focus preservation |
| 2 | I | After Tasks 2–3 | Full-page behaviour preservation; sidebar fields and widgets; custom field rendering; conditional visibility; tab persistence across locale/version remounts |
| 3 | I | After Tasks 4–7 | Field/tab ID ownership; explicit-ID handling; SSR/hydration stability; independently tested parent and child submit defences. Includes a small real-browser check — see Task 7, Step 6 |
| 4 | II | After Tasks 8–9, **before** Task 10 | Additive creation outcomes; retained version/revision and structured failure metadata; authenticated draft reads with explicit `status: 'any'`; display projections; proposed capability/provider types. **The outstanding product/API decisions must be resolved here**, before the tasks they block |
| 5 | II | After Tasks 10–13 | Consistent server/service/receipt types; capability degradation; supported-caller opt-in; nested-creation suppression; provider context; parent content-locale propagation; real upload-widget behaviour; picker state preservation |
| 6 | II | After Tasks 14–17 | Receipt retention before view transitions; single-select handoff; hydration retries after picker closure; committed-hook warnings; uncertain outcomes; selection-application failures; multiple-selection capacity, ordering and deduplication |
| 7 | II | After Tasks 18–22 and final verification | Guard coordination; real-browser focus/Escape/Enter behaviour; meaningful cross-form label/tab assertions; translations; documentation; the complete specification acceptance matrix. Reviews both the final incremental changes **and** the cumulative feature |

### Handoff template

Every handoff supplies all six items. "Not run" is an acceptable answer; silence is not.

```markdown
**Checkpoint:** N — <name>
**Tasks completed:** Task X … Task Y

**Diff scope:** base <sha> … head <sha>
  (or: uncommitted, `git diff <paths>` — state the exact paths)

**Changes:** <a few sentences>
**Deviations from plan/spec:** <each one, with the reason — or "none">

**Verification:**
| Command | Result |
|---|---|
| `pnpm lint` | pass |
| `pnpm typecheck` | pass |
| `pnpm knip` | pass |
| `cd packages/admin && pnpm test` | pass — 214 passed |
| Browser scenarios (manual / extension) | A-C pass; D not run — reason |

**Browser checks:** <scenarios exercised and what was observed; "none" if not applicable>
**Known concerns:** <anything uncertain, risky, or deliberately deferred>
**Decisions needed:** <questions that block dependent work — or "none">
```

Resolve review findings and report their verification before continuing dependent work.

---

## File Structure

### Part I — `refactor/forms`

**Phase 1 — #94 extractions (modify `packages/admin/src/forms/`)**

| File | Responsibility |
|---|---|
| `use-form-submission.ts` (create) | Validation → uploads → payload → submit, as a discriminated phase machine. No JSX. |
| `form-layout.tsx` (create) | The recursive field/row/group/tab render walk for both layout regions. No page chrome. |
| `use-form-tabs.ts` (create) | Active-tab persistence, conditional visibility, per-tab error counts. |
| `form-page-chrome.tsx` (create) | Heading row, status bar, concurrency notices, sidebar *widgets* — the page-level controls only. |
| `form-renderer.tsx` (modify) | Becomes a composition of the above. `FormRendererProps` unchanged. |

**Phase 2 — Concurrent-form correctness**

| File | Responsibility |
|---|---|
| `forms/form-dom-scope.tsx` (create) | `FormDomScopeProvider` + `useFormDomScope()`; one stable instance id, SSR/hydration-safe. |
| `fields/field-renderer.tsx` (modify:93) | Scope `htmlId`. |
| `fields/*/*-field.tsx` (modify) | Scope the `htmlId = id ?? fieldPath` fallback in each widget. |
| `presentation/tabs.tsx` (modify:73,76) | Take the scope in `tabTriggerId` / `tabPanelId`. |
| `forms/form-renderer.tsx` (modify:507) | Ignore submit events bubbling from a portalled child form. |

### Part II — `feature/relation-create-new`

**Phase 3 — host capabilities**

| File | Responsibility |
|---|---|
| `host/.../collections/create.ts` (modify) | Return `collectionId` on both outcomes. |
| `host/.../collections/save-outcome.ts` (modify:15) | Add `collectionId` to the committed-hook-failed response. |
| `host/.../collections/get-by-id.ts` (create) | Authorised exact-ID display read at a given locale. |
| `admin/fields/field-services-types.ts` (modify:114) | Three new optional members. |
| `host/.../integrations/byline-field-services.ts` (modify:60) | Wire them. |

**Phase 4–6 — the feature**

| File | Responsibility |
|---|---|
| `fields/relation/picker-session.ts` (create) | Session reducer: view, query, page, pending selections, receipts. |
| `fields/relation/relation-picker.tsx` (modify) | Two views in one modal; identity-first selection. |
| `fields/relation/relation-create-view.tsx` (create) | The embedded creation view. |
| `fields/relation/relation-display-state.ts` (create) | Loading / error / warning presentation state, keyed by target id + locale. |
| `fields/relation/relation-field.tsx`, `relation-many-field.tsx` (modify) | Own presentation state after picker close. |
| `packages/i18n/src/admin/*.json` (modify, ×8) | New keys. |
| *(no e2e spec file)* | Browser checks are manual / extension-driven — see Tasks 7 and 21. |

---

## Part I — Form refactor and concurrent-form correctness

**Branch:** `refactor/forms`, cut from `develop`.

```bash
git checkout develop && git pull
git checkout -b refactor/forms
```

Tasks 1–7, Checkpoints 1–3. Everything here is justified without embedded creation:
Phase 1 is #94's decomposition, behaviour-preserving by definition; Phase 2 fixes DOM
id collisions and cross-form submit leakage that are real accessibility and correctness
defects today, latent only because nothing currently nests.

**No open decisions block any of this.** Start immediately.

One constraint specific to this branch: `knip` and the public-export audit run on
pre-push, and this repo has bitten people before with newly-exported-but-unconsumed
types. Everything Part I adds must have a real consumer on this branch —
`FormContent` consumes the extracted hooks, the widgets consume the id scope. Do not
land feature-shaped scaffolding here just because it looks preparatory.

### Phase 1 — Prerequisite extractions from #94

Tracked by issue #94. **Acceptance for this phase is behaviour preservation**:
every existing form, navigation, scheduling, upload and concurrency test stays
green, and `FormRendererProps` does not change. The contribution this plan makes
to #94 is the *boundaries* — the signatures below are what Phase 4 consumes.

#### Task 1: Extract `useFormSubmission()`

**Files:**
- Create: `packages/admin/src/forms/use-form-submission.ts`
- Modify: `packages/admin/src/forms/form-renderer.tsx:507-620` (the `handleSubmit` closure)
- Test: `packages/admin/src/forms/use-form-submission.test.tsx`

**Interfaces:**
- Produces:
  ```ts
  export type SubmissionPhase =
    | { kind: 'idle' }
    | { kind: 'validating' }
    | { kind: 'uploading' }
    | { kind: 'confirmingSystemFields'; payload: SystemFieldsSubmitPayload }
    | { kind: 'submitting' }

  export interface UseFormSubmissionOptions {
    mode: 'create' | 'edit'
    fields: Field[]
    documentId?: string
    advertiseLocales?: boolean
    onSubmit: (payload: SystemFieldsSubmitPayload) => void | Promise<void>
    isBlocked: () => boolean
    /**
     * Called immediately before the form becomes `inert` — once before uploads
     * and once before submission — so the caller can record the focused element
     * and restore it when busy ends. The DOM refs stay in the component; the
     * hook only signals the transition.
     */
    onBeforeBusy?: () => void
  }

  export interface UseFormSubmissionResult {
    phase: SubmissionPhase
    isBusy: boolean
    submit: () => Promise<void>
    confirmSystemFields: () => Promise<void>
    cancelSystemFields: () => void
  }

  export function useFormSubmission(o: UseFormSubmissionOptions): UseFormSubmissionResult
  ```

- [ ] **Step 1: Write the failing test — phases are mutually exclusive**

```tsx
it('moves idle → validating → uploading → submitting and never overlaps', async () => {
  const seen: string[] = []
  const { result } = renderHookInForm(() =>
    useFormSubmission({
      mode: 'create',
      fields,
      onSubmit: async () => { seen.push('submit') },
      isBlocked: () => false,
    })
  )
  const phases: string[] = []
  const stop = observePhase(result, (p) => phases.push(p.kind))
  await act(async () => { await result.current.submit() })
  stop()
  expect(phases).toEqual(['validating', 'uploading', 'submitting', 'idle'])
  expect(seen).toEqual(['submit'])
})
```

- [ ] **Step 1b: Write the failing re-entry test**

```tsx
it('admits only one submission when two are issued in the same turn', async () => {
  const onSubmit = vi.fn()
  const gate = deferred()                    // suspends validation
  const { result } = renderHookInForm(() =>
    useFormSubmission({
      mode: 'create', fields, onSubmit, isBlocked: () => false,
      // test seam: validation awaits `gate` so both calls land before any rerender
    })
  )
  await act(async () => {
    void result.current.submit()
    void result.current.submit()             // no await between them
    gate.resolve()
  })
  expect(onSubmit).toHaveBeenCalledTimes(1)
})
```

- [ ] **Step 2: Run both and confirm they fail**

Run: `cd packages/admin && pnpm vitest run --mode=jsdom src/forms/use-form-submission.test.tsx`
Expected: FAIL — `useFormSubmission` is not exported.

- [ ] **Step 3: Move the closure into the hook**

Lift `form-renderer.tsx:507-620` verbatim into `use-form-submission.ts`, replacing
the rendered `useState` flags (`isUploading`, `isSubmitting`) with the discriminated
`phase`.

**Keep `submittingRef` — do not fold it into `phase`.** Rendered state is not a
re-entry guard: two `submit()` calls in the same turn both observe `phase.kind ===
'idle'` because React has not rerendered between them. The ref must be set
synchronously at the top of `submit()` and cleared in `finally`, spanning validation
through submission — the whole window, not just the final request. `phase` drives the
UI; the ref decides admission. This mirrors the existing synchronous
`mutationBlockedRef` and is required by #94's own constraints.

`captureFocusBeforeBusy` (`form-renderer.tsx:466`, called at `:491` and `:530`) owns
DOM refs that belong to the component, so it cannot move into the hook. Pass it as
`onBeforeBusy` and invoke it at exactly those two points — omitting it silently breaks
focus recovery on the full-page editor, which no embedded-creation test would catch.

Keep `getFieldValues`, `getPatches`,
`getDirtyBreakdown`, `getSystemPath`, `getSystemAvailableLocales`,
`getPendingUploads` and `clearPendingUploads` coming from `useFormContext()` —
**do not** copy field state into the hook.

- [ ] **Step 4: Re-point `FormContent` at the hook**

Replace the removed closure with `const submission = useFormSubmission({...})`,
and derive the existing `isUploading` / `isSubmitting` / `isBusy` booleans from
`submission.phase` so the JSX is untouched.

- [ ] **Step 4b: Prove full-page focus recovery still works**

```tsx
it('restores focus to the control that had it before the form went busy', async () => {
  const h = renderFullPageEditor()
  const input = h.getByLabelText('Title')
  input.focus()
  await h.submitAndResolve()
  expect(document.activeElement).toBe(input)
})
```

- [ ] **Step 5: Run the full admin suite**

Run: `cd packages/admin && pnpm test`
Expected: PASS, including `form-renderer-submit.test.tsx` and
`form-renderer-capabilities.test.tsx`, unchanged.

- [ ] **Step 6: Commit**

```bash
git add packages/admin/src/forms/use-form-submission.ts \
        packages/admin/src/forms/use-form-submission.test.tsx \
        packages/admin/src/forms/form-renderer.tsx
git commit -s -m "refactor(admin): extracted useFormSubmission from FormContent"
```

> ### ⏸ CHECKPOINT 1 — Submission extraction
>
> Request review from GPT-6 Astra before starting Task 2. Scope: synchronous
> re-entry protection across validation through submission, phase transitions,
> system-field confirmation, dirty-state handling, upload sequencing, mutation
> blocking, and full-page focus preservation.

#### Task 2: Extract `FormLayout` and `useFormTabs()`

**Files:**
- Create: `packages/admin/src/forms/form-layout.tsx`, `packages/admin/src/forms/use-form-tabs.ts`
- Modify: `packages/admin/src/forms/form-renderer.tsx:660-700, 963-1010`
- Test: `packages/admin/src/forms/form-layout.test.tsx`

**Interfaces:**
- Consumes: `useFormLayout()` from `use-form-layout.ts` (unchanged).
- Produces:
  ```ts
  export interface FormLayoutProps {
    fields: Field[]
    adminConfig?: AdminResourceConfig
    /** Which regions to render, in order. Default: ['main', 'sidebar']. */
    regions?: ReadonlyArray<'main' | 'sidebar'>
    /** 'split' = two columns (full page); 'stacked' = one column (embedded). */
    variant?: 'split' | 'stacked'
    disabled?: boolean
    collectionPath?: string
    activeLocale?: string
    /**
     * Controlled active-tab state. MUST stay owned above the keyed
     * `FormProvider` — see the note below.
     */
    activeTabBySet: Record<string, string>
    onTabChange: (tabSetName: string, tabName: string) => void
    /**
     * Page-level sidebar widgets (path, tree, available locales) rendered in
     * the same sidebar column, after the sidebar schema fields. The embedded
     * creation view passes nothing.
     */
    sidebarSlot?: ReactNode
  }
  export const FormLayout: (p: FormLayoutProps) => ReactNode
  ```

**This is the task that makes embedded creation possible.** `regions` must default
to both, and `'sidebar'` must render `layout.sidebar` **schema fields** through the
same `renderItem` walk. Page-level sidebar *widgets* are not part of `FormLayout`;
they arrive through `sidebarSlot` so the full-page editor still renders them in one
sidebar column together with the sidebar schema fields.

**Tab state must not move into `useFormTabs` wholesale.** `form-renderer.tsx:344-348`
lifts it into `FormRenderer` via `_activeTabBySet` / `_onTabChange` deliberately, with
the reason in the comment: *"so the user's tab choices survive the locale-change
remount triggered by FormProvider's `key` prop."* `useFormTabs` may own visibility
resolution, error counts and the default-tab computation, but the selected tab stays
controlled from above. `FormLayout` therefore takes `activeTabBySet` / `onTabChange`
rather than holding them.

- [ ] **Step 1: Write the failing test — sidebar schema fields always render**

```tsx
it('keeps the selected tab across a locale-change remount of FormProvider', () => {
  const h = renderFullPageEditor({ locale: 'en' })
  selectTab(h, 'main', 'seo')
  h.changeLocale('fr')                       // remounts FormProvider via its key
  expect(activeTabName(h, 'main')).toBe('seo')
})

it('renders page-level sidebar widgets after sidebar schema fields, in one column', () => {
  render(
    <FormLayout
      fields={fields}
      adminConfig={defineAdminConfig({ layout: { main: ['title'], sidebar: ['featured'] } })}
      activeTabBySet={{}} onTabChange={() => {}}
      sidebarSlot={<div data-testid="path-widget" />}
    />
  )
  const sidebar = document.querySelector('.byline-form-sidebar')!
  const order = [...sidebar.children].map((n) => n.getAttribute('data-field') ?? n.getAttribute('data-testid'))
  expect(order).toEqual(['featured', 'path-widget'])
})

it('renders layout.sidebar schema fields in stacked variant', () => {
  const adminConfig = defineAdminConfig({
    layout: { main: ['title'], sidebar: ['featured'] },
  })
  render(
    <FormLayout fields={fields} adminConfig={adminConfig} variant="stacked"
      activeTabBySet={{}} onTabChange={() => {}} />
  )
  expect(document.querySelector('[data-field="title"]')).not.toBeNull()
  expect(document.querySelector('[data-field="featured"]')).not.toBeNull()
})
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `cd packages/admin && pnpm vitest run --mode=jsdom src/forms/form-layout.test.tsx`
Expected: FAIL — `form-layout` module not found.

- [ ] **Step 3: Move the render walk**

Move `renderItem`, the row/group/tabset recursion and the two region `<div>`s out
of `FormContent` into `FormLayout`. Move active-tab state, conditional tab
visibility and per-tab error counts into `use-form-tabs.ts`. `FormContent` keeps
nothing of the walk.

- [ ] **Step 4: Run the full admin suite**

Run: `cd packages/admin && pnpm test`
Expected: PASS — no visual or behavioural change on the full-page editor.

- [ ] **Step 5: Commit**

```bash
git add packages/admin/src/forms/form-layout.tsx \
        packages/admin/src/forms/use-form-tabs.ts \
        packages/admin/src/forms/form-layout.test.tsx \
        packages/admin/src/forms/form-renderer.tsx
git commit -s -m "refactor(admin): extracted FormLayout and useFormTabs from FormContent"
```

#### Task 3: Split page-level chrome out of `FormContent`

**Files:**
- Create: `packages/admin/src/forms/form-page-chrome.tsx`
- Modify: `packages/admin/src/forms/form-renderer.tsx:707-960`
- Test: existing `form-renderer-capabilities.test.tsx` is the regression gate

**Interfaces:**
- Produces: `FormHeadingRow`, `FormStatusBar`, `FormConcurrencyNotices`,
  `FormSidebarWidgets` — each taking only the props it needs, no `FormRendererProps`
  pass-through object.

- [ ] **Step 1: Move each region into its own component, one at a time**

Heading row → status bar → concurrency notices → sidebar widgets. After each move
run `cd packages/admin && pnpm test` before starting the next. Four small commits
are better than one large one here.

- [ ] **Step 2: Confirm `FormContent` is now composition**

`FormContent`'s JSX return should be the busy announcer, `<form>`, the four chrome
components, `<FormLayout>`, and the modals. No inline status/tab/field walking.

- [ ] **Step 3: Run the whole workspace**

Run: `pnpm test && pnpm typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/admin/src/forms/form-page-chrome.tsx packages/admin/src/forms/form-renderer.tsx
git commit -s -m "refactor(admin): split page-level chrome out of FormContent"
```

---

> ### ⏸ CHECKPOINT 2 — Layout and presentation extraction
>
> Request review before starting Task 4. Scope: full-page behaviour preservation,
> sidebar fields *and* widgets, custom field rendering, conditional visibility, and
> tab persistence across locale/version remounts.

### Phase 2 — Concurrent-form correctness

A standalone correctness change. Ship it even if embedded creation slips: it fixes
a latent accessibility defect. Review it separately from Phase 1.

#### Task 4: Introduce the form DOM scope

**Files:**
- Create: `packages/admin/src/forms/form-dom-scope.tsx`
- Modify: `packages/admin/src/forms/form-context.tsx` (wrap children in the provider)
- Test: `packages/admin/src/forms/form-dom-scope.test.tsx`

**Interfaces:**
- Produces:
  ```ts
  /** Stable per-form-instance prefix, SSR/hydration-safe (React useId). */
  export function useFormDomScope(): string
  /** Scope a derived id. Returns `id` unchanged when caller-supplied. */
  export function useScopedDomId(base: string, explicit?: string): string
  export const FormDomScopeProvider: (p: { children: ReactNode }) => ReactNode
  ```

`useFormDomScope` must use React's `useId`, not a counter or `Math.random`, so the
server and client agree.

- [ ] **Step 1: Write the failing test — two mounted forms, distinct ids**

**Sequencing note:** `FieldRenderer` does not consume the scope until Task 5, so this
task tests the scope primitive itself. The distinct-field-id assertion lives in Task 5.

```tsx
it('gives two concurrently mounted providers different scopes', () => {
  const scopes: string[] = []
  const Probe = () => { scopes.push(useFormDomScope()); return null }
  render(
    <>
      <FormProvider initialData={{}}><Probe /></FormProvider>
      <FormProvider initialData={{}}><Probe /></FormProvider>
    </>
  )
  expect(scopes).toHaveLength(2)
  expect(new Set(scopes).size).toBe(2)
})

it('returns a caller-supplied id unchanged, and is stable across rerenders', () => {
  const seen: string[] = []
  const Probe = () => { seen.push(useScopedDomId('title')); return null }
  const { rerender } = render(<FormProvider initialData={{}}><Probe /></FormProvider>)
  rerender(<FormProvider initialData={{}}><Probe /></FormProvider>)
  expect(seen[0]).toBe(seen[1])
  expect(renderScoped(() => useScopedDomId('title', 'explicit-id'))).toBe('explicit-id')
})
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `cd packages/admin && pnpm vitest run --mode=jsdom src/forms/form-dom-scope.test.tsx`
Expected: FAIL — `form-dom-scope` module not found.

- [ ] **Step 3: Implement the provider and hooks**

```tsx
const FormDomScopeContext = createContext<string | null>(null)

export const FormDomScopeProvider = ({ children }: { children: ReactNode }) => {
  const scope = useId()
  return <FormDomScopeContext.Provider value={scope}>{children}</FormDomScopeContext.Provider>
}

export function useFormDomScope(): string {
  return useContext(FormDomScopeContext) ?? ''
}

export function useScopedDomId(base: string, explicit?: string): string {
  const scope = useFormDomScope()
  if (explicit != null) return explicit
  return scope === '' ? base : `${scope}${base}`
}
```

- [ ] **Step 4: Wrap `FormProvider`'s children in `FormDomScopeProvider`**

- [ ] **Step 5: Run the test and the suite**

Run: `cd packages/admin && pnpm vitest run --mode=jsdom src/forms/form-dom-scope.test.tsx && pnpm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/admin/src/forms/form-dom-scope.tsx \
        packages/admin/src/forms/form-dom-scope.test.tsx \
        packages/admin/src/forms/form-context.tsx
git commit -s -m "feat(admin): added a per-form-instance DOM id scope"
```

#### Task 5: Apply the scope to field ids

**Files:**
- Modify: `packages/admin/src/fields/field-renderer.tsx:93`
- Modify: `packages/admin/src/fields/{text,numerical,select,code,relation,image,file}/*.tsx` — each `htmlId = id ?? fieldPath`
- Test: `packages/admin/src/fields/field-dom-ids.test.tsx`

- [ ] **Step 1: Write the failing tests — distinct ids, and labels that resolve within their own form**

```tsx
it('gives two concurrently mounted forms distinct field ids', () => {
  renderTwoFormsWithTitle()
  const ids = Array.from(document.querySelectorAll('input')).map((n) => n.id)
  expect(ids).toHaveLength(2)
  expect(new Set(ids).size).toBe(2)
})
```

```tsx
it('associates each label with the input in its own form', () => {
  renderTwoFormsWithTitle()
  const [labelA, labelB] = Array.from(document.querySelectorAll('label'))
  const a = document.getElementById(labelA.getAttribute('for')!)
  const b = document.getElementById(labelB.getAttribute('for')!)
  expect(a).not.toBe(b)
})
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `cd packages/admin && pnpm vitest run --mode=jsdom src/fields/field-dom-ids.test.tsx`
Expected: FAIL — both `for` values resolve to the same node.

- [ ] **Step 3: Replace the derivation in `FieldRenderer`**

```ts
const htmlId = useScopedDomId(path.replace(/[[\].]/g, '-'))
```

- [ ] **Step 4: Replace each widget fallback**

```ts
const htmlId = useScopedDomId(fieldPath, id)
```

Do not double-prefix: `useScopedDomId` returns a caller-supplied `id` untouched.
Audit `${htmlId}-label`, `${htmlId}-error`, `${htmlId}-help` and every
`aria-describedby` / `aria-labelledby` in the same pass.

- [ ] **Step 5: Run the test and the suite**

Run: `cd packages/admin && pnpm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/admin/src/fields
git commit -s -m "fix(admin): scoped field dom ids to the form instance"
```

#### Task 6: Apply the scope to tab ids

**Files:**
- Modify: `packages/admin/src/presentation/tabs.tsx:73,76,351,352`
- Modify: `packages/admin/src/forms/form-layout.tsx` (the `idBase` construction —
  Task 2 moved the tab-set render out of `form-renderer.tsx:674`; if Task 2 has not
  landed yet, apply it there instead and carry it across during Task 2)
- Test: `packages/admin/src/presentation/tab-dom-ids.test.tsx`

- [ ] **Step 1: Write the failing test — same tab-set name, two forms**

```tsx
it('keeps tab panel and trigger ids distinct across two forms with a "main" tab set', () => {
  renderTwoFormsWithTabSetNamed('main')
  const triggers = Array.from(document.querySelectorAll('[role="tab"]')).map((n) => n.id)
  expect(new Set(triggers).size).toBe(triggers.length)
  for (const panel of document.querySelectorAll('[role="tabpanel"]')) {
    const owner = document.getElementById(panel.getAttribute('aria-labelledby')!)
    expect(panel.closest('form')).toBe(owner!.closest('form'))
  }
})
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `cd packages/admin && pnpm vitest run --mode=jsdom src/presentation/tab-dom-ids.test.tsx`
Expected: FAIL — `aria-labelledby` resolves to the first form's trigger.

- [ ] **Step 3: Thread the scope into `idBase`**

```ts
const scope = useFormDomScope()
const idBase = `${scope}tabset:${set.name}`
```

`tabTriggerId` / `tabPanelId` keep their signatures — the scope arrives inside
`idBase`, so no other caller changes.

- [ ] **Step 4: Run the test and the suite**

Run: `cd packages/admin && pnpm test`
Expected: PASS.

- [ ] **Step 5: Run the static gates and commit**

```bash
pnpm lint && pnpm typecheck && pnpm knip
git add packages/admin/src
git commit -s -m "fix(admin): scoped tab dom ids to the form instance"
```

#### Task 7: Isolate submit events across the portal

**Files:**
- Modify: `packages/admin/src/forms/form-renderer.tsx:507` (`handleSubmit`)
- Test: `packages/admin/src/forms/form-submit-isolation.test.tsx`

**Why:** a portalled modal is not inside the outer `<form>` in the DOM, so invalid
nested-form markup never arises — but React synthetic events propagate up the
*React* tree through portals. The outer `handleSubmit` calls `preventDefault()` and
**not** `stopPropagation()`, so an inner submit, or an Enter keypress in an inner
text input, would run the parent's submission. Fix it in both directions.

- [ ] **Step 1: Write the failing tests**

```tsx
it('does not run the parent submit handler when a portalled inner form submits', async () => {
  const parentSubmit = vi.fn()
  renderFormWithPortalledInnerForm({ parentSubmit })
  await act(async () => {
    innerForm().dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  })
  expect(parentSubmit).not.toHaveBeenCalled()
})

it('does not run the parent submit handler on Enter in an inner text input', async () => {
  const parentSubmit = vi.fn()
  renderFormWithPortalledInnerForm({ parentSubmit })
  await pressEnterIn(innerForm().querySelector('input')!)
  expect(parentSubmit).not.toHaveBeenCalled()
})

it('still submits normally from the parent form itself', async () => {
  const parentSubmit = vi.fn()
  renderFormWithPortalledInnerForm({ parentSubmit })
  await act(async () => {
    parentForm().dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  })
  expect(parentSubmit).toHaveBeenCalledTimes(1)
})
```

- [ ] **Step 2: Run them and confirm the first two fail**

Run: `cd packages/admin && pnpm vitest run --mode=jsdom src/forms/form-submit-isolation.test.tsx`
Expected: FAIL — `parentSubmit` is called for the inner form's submit and for Enter.

- [ ] **Step 3: Guard the parent handler on its own form element**

```ts
const handleSubmit = (e: React.SubmitEvent<HTMLFormElement>) => {
  // A portalled child form's submit bubbles through the React tree even though
  // it is not a DOM descendant. `currentTarget` is always THIS form while this
  // handler runs — including for a bubbled child submit — so it proves nothing.
  // Compare the event's origin instead.
  if (e.target !== e.currentTarget) return
  if (mutationBlockedRef.current) { e.preventDefault(); return }
  e.preventDefault()
  // …unchanged…
}
```

- [ ] **Step 4: Stop propagation on the embedded side too**

Any nested form rendered inside a portal must call `e.stopPropagation()` in its own
submit handler. Phase 4's creation view relies on this; add it there as well rather
than depending on the parent guard alone.

**The two defences must be tested separately.** If the inner form stops propagation,
a broken parent guard is invisible. The first two tests in Step 1 therefore render an
inner form that deliberately does **not** call `stopPropagation()`, so they exercise
the parent guard alone. Add one further test with `stopPropagation()` restored, to
prove the child-side defence independently.

- [ ] **Step 5: Run the test and the whole admin suite**

Run: `cd packages/admin && pnpm vitest run --mode=jsdom src/forms/form-submit-isolation.test.tsx && pnpm test`
Expected: PASS.

- [ ] **Step 6: Browser check — id uniqueness and hydration stability**

Required by Checkpoint 3. jsdom cannot prove this: `useId` must produce the same values
in the server render and on hydration, and a mismatch surfaces only in a real browser,
as a console error plus silently re-keyed ids.

There is no e2e suite — run this by hand or drive it with the Claude-in-Chrome
extension. Start the dev server (`pnpm dev`), sign in, and open a `docs` document
(`docs` declares tab sets; `media` does not).

**Scenario**
1. Open DevTools **before** navigating, so hydration errors are captured.
2. Navigate to the `docs` edit view; let it finish loading.
3. Paste the snippet below into the console.
4. Hard-reload and repeat, confirming the id list is identical between loads.

```js
// Paste into the console on the docs edit view. Prints PASS/FAIL per check.
(() => {
  const ids = [...document.querySelectorAll('[id]')].map(n => n.id)
  const dupes = ids.filter((v, i) => ids.indexOf(v) !== i)

  const labelProblems = []
  for (const l of document.querySelectorAll('label[for]')) {
    const t = document.getElementById(l.getAttribute('for'))
    if (!t) labelProblems.push('dangling for=' + l.getAttribute('for'))
    else if (t.closest('form') !== l.closest('form')) labelProblems.push('cross-form: ' + l.textContent.trim())
  }
  const tabProblems = []
  for (const pnl of document.querySelectorAll('[role="tabpanel"][aria-labelledby]')) {
    const owner = document.getElementById(pnl.getAttribute('aria-labelledby'))
    if (!owner) tabProblems.push('dangling aria-labelledby')
    else if (owner.closest('form') !== pnl.closest('form')) tabProblems.push('cross-form tab')
  }

  console.table([
    { check: 'unique ids',      result: dupes.length ? 'FAIL' : 'PASS', detail: dupes.join(', ') },
    { check: 'label ownership', result: labelProblems.length ? 'FAIL' : 'PASS', detail: labelProblems.join(', ') },
    { check: 'tab ownership',   result: tabProblems.length ? 'FAIL' : 'PASS', detail: tabProblems.join(', ') },
    { check: 'tab panels seen', result: document.querySelectorAll('[role="tabpanel"]').length ? 'PASS' : 'FAIL' },
  ])
  copy(ids.join('\n'))   // clipboard: compare between loads
  return ids.length + ' ids captured and copied'
})()
```

**Expected:** all four rows PASS, the console shows no hydration warning
(`did not match`, `Hydration failed`), and the copied id list is identical across two
loads. Record the observed output in the Checkpoint 3 handoff.

- [ ] **Step 7: Commit**

```bash
git add packages/admin/src/forms/form-renderer.tsx \
        packages/admin/src/forms/form-submit-isolation.test.tsx
git commit -s -m "fix(admin): isolated form submit events from portalled child forms"
```

---

> ### ⏸ CHECKPOINT 3 — Concurrent-form correctness
>
> Request review before starting Task 8. Scope: field/tab ID ownership,
> explicit-ID handling, SSR/hydration stability, and parent and child submit
> defences tested independently. Include the Task 7 Step 6 browser check (manual or
> extension-driven — there is no e2e suite).

---

## Part I complete — verify, merge, then branch for Part II

- [ ] **Run the Part I gates**

```
pnpm byline:generate:check
pnpm lint
pnpm typecheck
pnpm knip
pnpm test
pnpm test:integration
```

Plus the Task 7 Step 6 browser check (manual or extension-driven), with its observed
output recorded.

- [ ] **Confirm Part I preserved behaviour**

`FormRendererProps` is unchanged. Every pre-existing form, navigation, scheduling,
upload and concurrency test passes untouched. The full-page editor looks and behaves
exactly as before — tab choices still survive a locale change, focus still returns
after a save, sidebar widgets still sit in the sidebar with the sidebar schema fields.

- [ ] **Merge `refactor/forms` into `develop`**

This is a hot-path change to the editing surface. Merge it on its own, so that if
something surfaces later it bisects to a small, behaviour-preserving diff rather than
being tangled with feature work.

- [ ] **Cut the feature branch from the merged `develop`**

```bash
git checkout develop && git pull
git checkout -b feature/relation-create-new
```

Do not branch Part II from `refactor/forms`, and do not start Part II before the merge
lands — Part II consumes `useFormSubmission`, `FormLayout` and the id scope directly,
and rebasing that consumption across an unmerged refactor is avoidable pain.

---

## Part II — Embedded relationship creation

**Branch:** `feature/relation-create-new`, cut from `develop` after Part I merges.

Tasks 8–22, Checkpoints 4–7. Unlike Part I, this part **is** gated: the five product
and API decisions at the end of this plan must be answered at Checkpoint 4, and Task 10
onward is blocked until they are.

Tasks 8 and 9 are the first work on this branch — **"first" meaning once Part I has
merged and this branch exists, not in parallel with Part I.** No Part II task runs
alongside Part I.

### Phase 3 — Host capabilities

#### Task 8: Return the collection id on every creation outcome

**Files:**
- Modify: `packages/host-tanstack-start/src/server-fns/collections/create.ts:84-89`
- Modify: `packages/host-tanstack-start/src/server-fns/collections/save-outcome.ts:15-45`
- Test: `packages/host-tanstack-start/src/server-fns/collections/create.test.node.ts`

**Why:** the server already has `config.collection.id` (`create.ts:58`) but returns
neither outcome with it. The picker must not need a list response to learn it.

**Interfaces:** — strictly additive. The existing committed-hook contract is
consumed by eleven server fns (collections *and* singletons: update, duplicate,
copy-to-locale, delete-locale, restore-version) and six admin-shell components.
Nothing may be removed or renamed.

  ```ts
  // success — one field added
  { status: 'ok'; documentId: string; documentVersionId: string
    revision: number; collectionId: string }

  // committed-hook-failed — UNCHANGED shape from the shared helper …
  interface CollectionDocumentCommittedHookFailureResponse {
    status: 'committed-hook-failed'
    documentId: string
    documentVersionId: string
    revision: number
    sideEffectFailure: { phase: DocumentHookCommittedPhase; code: DocumentHookSideEffectCode }
  }

  // … enriched only at the create call site
  type CreateCommittedHookFailureResponse =
    CollectionDocumentCommittedHookFailureResponse & { collectionId: string }
  ```

**Do not add `collectionId` to `toCommittedDocumentHookFailureResponse`.** That
helper is shared with update, duplicate, copy-to-locale, delete-locale,
restore-version and the singleton equivalents, and `getDocumentHookCommittedDetails`
carries no collection identity. Enrich the object at the create handler, where
`config.collection.id` is already in scope (`create.ts:58`).

- [ ] **Step 1: Write the failing test**

Note the input field is `collection`; `path` on this input is the explicit
*document* path, not the collection (`create.ts:27-41`).

```ts
it('returns collectionId on success without dropping existing metadata', async () => {
  const ok = await createCollectionDocument({ data: { collection: 'media', data: seedData } })
  expect(ok).toMatchObject({
    status: 'ok',
    collectionId: expect.any(String),
    documentId: expect.any(String),
    documentVersionId: expect.any(String),
    revision: expect.any(Number),
  })
})

it('returns collectionId on committed-hook failure, keeping sideEffectFailure intact', async () => {
  withFailingAfterCreateHook('media')
  const failed = await createCollectionDocument({ data: { collection: 'media', data: seedData } })
  expect(failed).toMatchObject({
    status: 'committed-hook-failed',
    collectionId: expect.any(String),
    documentVersionId: expect.any(String),
    revision: expect.any(Number),
    sideEffectFailure: { phase: expect.any(String), code: expect.any(String) },
  })
})

it('leaves the shared helper contract unchanged', () => {
  const r = toCommittedDocumentHookFailureResponse(committedHookError({ documentId: 'd1' }))
  expect(r).not.toHaveProperty('collectionId')
})
```

Both outcomes are asserted **through the create server function**, not by calling the
helper directly — the enrichment lives in the handler.

- [ ] **Step 2: Run it and confirm it fails**

Run: `cd packages/host-tanstack-start && pnpm vitest run --mode=node src/server-fns/collections/create.test.node.ts`
Expected: FAIL — `collectionId` is `undefined` on both.

- [ ] **Step 3: Add `collectionId` to both shapes**

In `create.ts`, add `collectionId: config.collection.id` to the success return, and
spread it onto the committed-failure object at the call site:

```ts
const committedFailure = toCommittedDocumentHookFailureResponse(error)
if (committedFailure != null) {
  return { ...committedFailure, collectionId: config.collection.id }
}
```

`save-outcome.ts` gains only the exported `CreateCommittedHookFailureResponse`
intersection type. Its runtime helper and its existing interface are untouched, so
no other caller changes.

- [ ] **Step 4: Run the host suite**

Run: `cd packages/host-tanstack-start && pnpm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/host-tanstack-start/src/server-fns/collections/create.ts \
        packages/host-tanstack-start/src/server-fns/collections/save-outcome.ts \
        packages/host-tanstack-start/src/server-fns/collections/create.test.node.ts
git commit -s -m "feat(host): returned the collection id on every create outcome"
```

#### Task 9: Authorised exact-ID display read

**Files:**
- Create: `packages/host-tanstack-start/src/server-fns/collections/get-display-record.ts`
- Test: `packages/host-tanstack-start/src/server-fns/collections/get-display-record.test.node.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface GetDisplayRecordInput {
    collection: string
    documentId: string
    locale: string
    fields: string[]
  }
  export interface DisplayRecord {
    id: string
    /** Top-level document metadata the picker row and summary render. */
    status: string
    path: string | null
    fields: Record<string, unknown>
  }
  export const getDisplayRecord: (i: GetDisplayRecordInput) => Promise<DisplayRecord | null>
  ```

Use **`getAdminBylineClient()`**, exactly as `server-fns/collections/get.ts:54` does.
Do **not** use the viewer client: without a preview cookie it reads as anonymous and
published-only, and an embedded create always produces a draft (media's workflow
defaults to `draft`), so every hydration would fail. The admin client still applies
`beforeRead` / `afterRead` and asserts `collections.<path>.read` — assert **read**,
not an edit-specific ability, and never `_bypassBeforeRead`.

Return top-level metadata alongside `fields`: the media item view renders `status`,
and `path` is the display fallback when `useAsTitle` is empty. `{ id, fields }` alone
is not enough for the picker row or the selected tile.

- [ ] **Step 1: Write the failing test**

```ts
it('reads one document by id under read ability and honours beforeRead', async () => {
  const rec = await getDisplayRecord({
    collection: 'media', documentId: seeded.id, locale: 'en', fields: ['title'],
  })
  expect(rec).toMatchObject({ id: seeded.id, fields: { title: 'Seeded' } })
})

it('reads a newly created unpublished document with no preview cookie', async () => {
  const created = await createDraft('media', { title: 'Draft only' })
  const rec = await getDisplayRecord({
    collection: 'media', documentId: created.documentId, locale: 'en', fields: ['title'],
  })
  expect(rec).toMatchObject({ id: created.documentId, status: 'draft' })
  expect(rec!.fields.title).toBe('Draft only')
})

it('returns null rather than throwing when the actor cannot read the target', async () => {
  await expect(asActorWithout('collections.media.read', () =>
    getDisplayRecord({ collection: 'media', documentId: seeded.id, locale: 'en', fields: ['title'] })
  )).resolves.toBeNull()
})
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `cd packages/host-tanstack-start && pnpm vitest run --mode=node src/server-fns/collections/get-display-record.test.node.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the server fn**

Mirror `server-fns/collections/get.ts`: resolve the request context via
`getAdminRequestContext()`, take `getAdminBylineClient()` from
`@byline/client/server`, call `findById(documentId, { locale, status: 'any' })`, and
project to `{ id, status, path, fields }` with only the requested field names.

**`status: 'any'` is mandatory.** `resolveReadMode` is `status ?? 'published'`
(`collection-handle.ts:1789`) and applies *regardless of which client asked* —
`packages/client/src/server/clients.ts:43` says so explicitly. An authenticated admin
client does not change it. Since every embedded create produces a draft, omitting
`status: 'any'` makes hydration fail every single time.

Use `findById`, **not** `findByIdForEdit` (which `get.ts:67` uses): the spec forbids
requiring an edit-specific read capability merely to display a selectable document.

- [ ] **Step 4: Run the host suite and commit**

```bash
cd packages/host-tanstack-start && pnpm test
git add packages/host-tanstack-start/src/server-fns/collections/get-display-record.ts \
        packages/host-tanstack-start/src/server-fns/collections/get-display-record.test.node.ts
git commit -s -m "feat(host): added an authorised exact-id display read"
```

> ### ⏸ CHECKPOINT 4 — Server contracts and API decisions
>
> Request review before starting Task 10. Scope: additive creation outcomes,
> retained version/revision and structured failure metadata, authenticated draft
> reads with explicit `status: 'any'`, display projections, and the proposed
> capability/provider types.
>
> **This is also where the outstanding product/API decisions get resolved** — see
> *Open decisions that gate implementation* at the end of this plan. Task 10 and
> everything after it are blocked until they are.

#### Task 10: Inject the three capabilities into the field layer

**Files:**
- Modify: `packages/admin/src/fields/field-services-types.ts:114`
- Modify: `packages/host-tanstack-start/src/integrations/byline-field-services.ts:60`
- Modify: `packages/host-tanstack-start/src/routes/create-admin-layout-route.tsx:119`
  (composes the reactive `getCreateContext` — see Step 3)
- Test: `packages/host-tanstack-start/src/routes/create-admin-layout-route.test.tsx`
- Test: `packages/admin/src/fields/field-services-degradation.test.tsx`

**Interfaces:**
- Produces (all **optional** — a host that implements selection only must keep working):
  ```ts
  export type CreateDocumentFn = (input: {
    collection: string
    data: Record<string, unknown>
  }) => Promise<CreateDocumentOutcome>

  /** Mirrors the Task 8 wire contract exactly — no metadata dropped, no invented string. */
  export type CreateDocumentOutcome =
    | {
        status: 'ok'
        documentId: string
        documentVersionId: string
        revision: number
        collectionId: string
      }
    | {
        status: 'committed-hook-failed'
        documentId: string
        documentVersionId: string
        revision: number
        collectionId: string
        sideEffectFailure: {
          phase: DocumentHookCommittedPhase
          code: DocumentHookSideEffectCode
        }
      }

  /** Mirrors the Task 9 `DisplayRecord` exactly. */
  export type GetDisplayRecordFn = (input: {
    collection: string; documentId: string; locale: string; fields: string[]
  }) => Promise<{
    id: string
    status: string
    path: string | null
    fields: Record<string, unknown>
  } | null>

  export type GetCreateContextFn = (input: { collection: string }) => {
    canCreate: boolean
    defaultContentLocale: string
  }

  export interface BylineFieldServices {
    // …existing members unchanged…
    createDocument?: CreateDocumentFn
    getDisplayRecord?: GetDisplayRecordFn
    getCreateContext?: GetCreateContextFn
  }
  ```

**No `warning: string` anywhere in this chain.** The server returns a structured
`sideEffectFailure: { phase, code }`; the receipt carries it unchanged; the
presentation layer turns `code` into localised copy at render time via the
`byline-admin` namespace (Task 20). A prose string crossing the wire cannot be
translated and discards the phase.

`getCreateContext` must read the host's real ability snapshot
(`integrations/abilities.tsx`, including `is_super_admin`) — never rebuild the
ability key by string concatenation in `@byline/admin`.

**It cannot be a plain module-level callback.** `bylineFieldServices` is a
module-level object (`byline-field-services.ts:60`) while `useAbilities()` reads
React route context, and hooks may not be called from an ordinary service function.
Compose the reactive members where the provider is rendered — inside the admin
layout route component at `routes/create-admin-layout-route.tsx:119`:

```tsx
const { has, isSuperAdmin } = useAbilities()
const defaultContentLocale = useDefaultContentLocale()
const services = useMemo<BylineFieldServices>(() => ({
  ...bylineFieldServices,
  getCreateContext: ({ collection }) => ({
    canCreate: isSuperAdmin || has(`collections.${collection}.create`),
    defaultContentLocale,
  }),
}), [has, isSuperAdmin, defaultContentLocale])

return <BylineFieldServicesProvider services={services}>…</BylineFieldServicesProvider>
```

The ability key is built by the **host**, which owns that mapping; `@byline/admin`
only calls `getCreateContext`. Keep `createDocument` and `getDisplayRecord` on the
module-level object — they need no React context.

**Sequencing note:** the Create affordance does not exist until Task 12, so this
task tests the *capability surface* only. Affordance gating is tested in Task 12.

- [ ] **Step 1: Write the failing test — the host supplies a real ability snapshot**

```tsx
it('derives canCreate from the host ability snapshot, honouring super-admin', () => {
  const asEditor = renderLayoutWithAbilities({ abilities: ['collections.media.create'] })
  expect(asEditor.services.getCreateContext!({ collection: 'media' }).canCreate).toBe(true)
  expect(asEditor.services.getCreateContext!({ collection: 'news' }).canCreate).toBe(false)

  const asSuper = renderLayoutWithAbilities({ abilities: [], isSuperAdmin: true })
  expect(asSuper.services.getCreateContext!({ collection: 'news' }).canCreate).toBe(true)
})

it('keeps selection working for a host that wires none of the three', () => {
  const services = { getCollectionDocuments, uploadField }
  expect(() => renderPickerWithServices(services)).not.toThrow()
  expect(services).not.toHaveProperty('createDocument')
})
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `cd packages/host-tanstack-start && pnpm vitest run --mode=jsdom src/routes/create-admin-layout-route.test.tsx`
Expected: FAIL — `getCreateContext` is undefined.

- [ ] **Step 3: Add the optional members and wire the host**

- [ ] **Step 4: Run both suites and commit**

```bash
pnpm typecheck
git add packages/admin/src/fields/field-services-types.ts \
        packages/admin/src/fields/field-services-degradation.test.tsx \
        packages/host-tanstack-start/src/integrations/byline-field-services.ts \
        packages/host-tanstack-start/src/routes/create-admin-layout-route.tsx \
        packages/host-tanstack-start/src/routes/create-admin-layout-route.test.tsx
git commit -s -m "feat(admin): added optional create, display-read and create-context services"
```

---

### Phase 4 — Picker session and the creation view

#### Task 11: Identity-first selection

**Files:**
- Create: `packages/admin/src/fields/relation/picker-session.ts`
- Modify: `packages/admin/src/fields/relation/relation-picker.tsx:121-243`
- Test: `packages/admin/src/fields/relation/picker-session.test.node.ts`

**Why:** today `relation-picker.tsx:226` derives the record with
`documents.find(...)`, and confirm bails without a `collectionId` that only the
list response supplies (`:135`). A created document has neither.

**Interfaces:**
- Consumes: `CreateDocumentOutcome` from Task 10. **Note the rename at the boundary** —
  the transport speaks `documentId` / `collectionId`; the picker session and the
  selection contract speak `targetDocumentId` / `targetCollectionId`. Map once, where
  the outcome becomes a receipt, and nowhere else.
- Produces:
  ```ts
  export interface CreationReceipt {
    targetDocumentId: string
    targetCollectionId: string
    documentVersionId: string
    revision: number
    outcome: 'ok' | 'committed-hook-failed'
    /** Present only when outcome is 'committed-hook-failed'. Structured, never prose. */
    sideEffectFailure?: { phase: DocumentHookCommittedPhase; code: DocumentHookSideEffectCode }
    createdInLocale: string
  }
  export interface PickerSessionState {
    view: 'select' | 'create'
    query: string
    page: number
    collectionId: string | null
    selectedDocumentId: string | null
    selectedMap: Map<string, Record<string, unknown> | undefined>
    receipts: Map<string, CreationReceipt>
  }
  export type PickerSessionAction =
    | { type: 'enterCreate' } | { type: 'backToSelect' }
    | { type: 'listLoaded'; collectionId: string; documents: unknown[] }
    | { type: 'creationConfirmed'; receipt: CreationReceipt }
    | { type: 'selectRow'; documentId: string }
  export function pickerSessionReducer(s: PickerSessionState, a: PickerSessionAction): PickerSessionState
  ```

- [ ] **Step 1: Write the failing test — selection without a list row**

```ts
it('can select a created document before any list response arrives', () => {
  let s = initialPickerSession()
  s = pickerSessionReducer(s, { type: 'creationConfirmed', receipt: {
    targetDocumentId: 'd1', targetCollectionId: 'c1', outcome: 'ok', createdInLocale: 'en',
  }})
  expect(s.collectionId).toBe('c1')
  expect(s.receipts.get('d1')?.outcome).toBe('ok')
})

it('preserves query, page and prior selections across a view change', () => {
  let s = { ...initialPickerSession(), query: 'sun', page: 3 }
  s = pickerSessionReducer(s, { type: 'selectRow', documentId: 'a' })
  s = pickerSessionReducer(s, { type: 'enterCreate' })
  s = pickerSessionReducer(s, { type: 'backToSelect' })
  expect(s).toMatchObject({ query: 'sun', page: 3, view: 'select' })
  expect(s.selectedDocumentId).toBe('a')
})
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `cd packages/admin && pnpm vitest run --mode=node src/fields/relation/picker-session.test.node.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the reducer, then move the picker's `useState` calls onto it**

`creationConfirmed` sets `collectionId` when it is still `null`. Confirm reads the
record from `documents` **when present**, and otherwise emits the selection with
`record: undefined` — which `RelationPickerSelection` already permits (`:53`).

- [ ] **Step 4: Run the admin suite**

Run: `cd packages/admin && pnpm test`
Expected: PASS — existing picker behaviour unchanged.

- [ ] **Step 5: Commit**

```bash
git add packages/admin/src/fields/relation/picker-session.ts \
        packages/admin/src/fields/relation/picker-session.test.node.ts \
        packages/admin/src/fields/relation/relation-picker.tsx
git commit -s -m "refactor(admin): moved relation picker state into an identity-first session reducer"
```

#### Task 12: Two views in one modal

**Files:**
- Modify: `packages/admin/src/fields/relation/relation-picker.tsx:262-461`
- Test: `packages/admin/src/fields/relation/relation-picker-views.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
it('switches to the creation view and back without resetting the session', async () => {
  renderPicker({ services: fullServices })
  await typeInSearch('sun')
  await click(screen.getByRole('button', { name: 'Create media' }))
  expect(screen.getByRole('heading', { name: /create media/i })).toBeTruthy()
  await click(screen.getByRole('button', { name: 'Back' }))
  expect(screen.getByRole('searchbox')).toHaveValue('sun')
})
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `cd packages/admin && pnpm vitest run --mode=jsdom src/fields/relation/relation-picker-views.test.tsx`
Expected: FAIL — no Create affordance.

- [ ] **Step 3: Render the Create affordance and the view switch**

Gate the affordance on `services.createDocument != null` **and**
`getCreateContext({ collection }).canCreate`. A loading or failed list request must
not hide it. Change the modal title on entering creation.

Eligibility is the conjunction of **four** conditions, all required:

```ts
const canOfferCreate =
  allowCreate &&                                  // opt-in from the consuming widget
  services.createDocument != null &&
  services.getDisplayRecord != null &&            // a created item must be presentable
  (services.getCreateContext?.({ collection: targetCollectionPath }).canCreate ?? false)
```

`getCreateContext` is optional, so a host that omits it yields `false` — creation is
opt-in, never assumed. `getDisplayRecord` is required because a created document that
can never be displayed is not a usable selection.

`allowCreate` defaults to **`false`**. Only the built-in single and multiple relation
widgets pass `true`. Rich-text insertion dialogs and any other `RelationPicker`
consumer therefore keep today's behaviour without being touched.

**Propagation.** A prop on the picker does not reach relation widgets nested in
groups, arrays, blocks or custom layouts — those render `RelationField` themselves
and never see it. Suppression travels by React context instead:

```tsx
/** Present and false anywhere inside an embedded creation view. */
export const RelationCreateAllowedContext = createContext<boolean>(true)
export const useRelationCreateAllowed = (): boolean =>
  useContext(RelationCreateAllowedContext)
```

`RelationCreateView` wraps its whole subtree in
`<RelationCreateAllowedContext.Provider value={false}>`, and every relation widget
reads `useRelationCreateAllowed()` into its own `allowCreate`. Depth is never
inferred. Suppress the affordance for any picker opened **from inside** a creation
view: relations nested in the embedded form may select existing documents but must not start a second creation session. Pass an explicit `allowCreate={false}` down that path rather than inferring depth, and assert it:

```tsx
it('offers no Create affordance for a picker opened inside a creation view', async () => {
  await openCreateViewFor('fixture')
  await click(screen.getByRole('button', { name: 'Select related' }))
  expect(screen.queryByRole('button', { name: /^Create / })).toBeNull()
})

it('suppresses creation for a relation nested in a group, array or block', async () => {
  await openCreateViewFor('fixture-with-nested-relations')
  for (const container of ['group', 'array', 'block']) {
    await click(screen.getByRole('button', { name: `Select ${container} relation` }))
    expect(screen.queryByRole('button', { name: /^Create / })).toBeNull()
    await click(screen.getByRole('button', { name: 'Close' }))
  }
})

it('leaves a rich-text insertion picker unchanged', async () => {
  renderInlineImageModal({ services: fullServices })
  expect(screen.queryByRole('button', { name: /^Create / })).toBeNull()
})
```

- [ ] **Step 4: Run and commit**

```bash
cd packages/admin && pnpm test
git add packages/admin/src/fields/relation
git commit -s -m "feat(admin): added a creation view to the relation picker"
```

#### Task 13: Mount the ordinary form in the creation view

**Files:**
- Modify: `packages/admin/src/forms/form-context.tsx:176-194` (expose the active content locale)
- Modify: `packages/admin/src/forms/form-renderer.tsx:303` (feed `contentLocale` into the provider)
- Modify: `packages/admin/src/fields/relation/relation-field.tsx`, `relation-many-field.tsx`
- Create: `packages/admin/src/fields/relation/relation-create-view.tsx`
- Test: `packages/admin/src/fields/relation/relation-create-view.test.tsx`
- Test: `packages/admin/src/fields/relation/relation-locale-propagation.test.tsx`

- [ ] **Step 0: Give relation widgets a route to the parent's content locale**

`parentActiveLocale` has nowhere to come from today. `FormProvider` exposes no active
locale (`form-context.tsx:176-194` is `{children, initialData, documentId,
collectionPath}`), and `relation-field.tsx` contains no locale reference at all —
`FieldRenderer` takes an `activeLocale` for the localised-field badge, but relation
widgets neither receive nor forward it.

Put it on form context, exactly as `collectionPath` already is, and for the same
documented reason — *"so upload widgets can reach the upload endpoint from any nesting
depth without every container forwarding it"*. Prop-drilling would miss relations
nested in groups, arrays and blocks.

**This is the parent's *content* locale, not the admin interface language.** Never
substitute `useTranslation()`'s locale.

```tsx
// form-context.tsx — new provider prop, exposed on FormContextType
contentLocale?: string | null
// form-renderer.tsx — feed the existing state in
<FormProvider … contentLocale={contentLocale}>
```

```tsx
it('reaches a relation nested in a group, array and block from a fr parent editor', async () => {
  // Open the REAL news editor at ?locale=fr — do not inject parentActiveLocale into
  // a creation-view fixture, which would pass while the propagation gap remained.
  const h = renderNewsEditor({ locale: 'fr' })
  for (const where of ['top-level', 'group', 'array', 'block']) {
    await openPickerFor(h, where)
    await click(screen.getByRole('button', { name: /^Create / }))
    expect(screen.getByText(/New documents are created in English/)).toBeTruthy()
    await click(screen.getByRole('button', { name: 'Back' }))
  }
})
```

**Interfaces:**
- Consumes: `FormLayout` (Task 2), `useFormSubmission` (Task 1), `FormDomScopeProvider` (Task 4).
- Produces:
  ```ts
  export interface RelationCreateViewProps {
    targetCollectionPath: string
    targetDefinition: MultiCollectionDefinition
    targetAdminConfig: CollectionAdminConfig | null
    defaultContentLocale: string
    parentActiveLocale: string
    primaryActionLabel: string
    onCreated: (receipt: CreationReceipt) => void
    onBack: () => void
  }
  ```

- [ ] **Step 1: Write the failing test — every editable field renders, sidebar included**

The upload test must select a real file through the widget rather than injecting a
pending-upload fixture — a fixture would pass even with `collectionPath` missing.

```tsx
it('uploads a file chosen through the real image widget', async () => {
  renderCreateView({ targetCollectionPath: 'media' })
  await selectFile(screen.getByLabelText('Image'), new File(['x'], 'a.png', { type: 'image/png' }))
  await fillRequired({ title: 'A', altText: 'B' })
  await click(screen.getByRole('button', { name: 'Create and select' }))
  expect(uploadField).toHaveBeenCalledWith('media', expect.any(FormData), false)
})

it('renders main and sidebar schema fields, and required fields still validate', async () => {
  renderCreateView({ targetCollectionPath: 'fixture', adminConfig: sidebarLayout })
  expect(screen.getByLabelText('Title')).toBeTruthy()
  expect(screen.getByLabelText('Featured')).toBeTruthy()   // declared in layout.sidebar
  await click(screen.getByRole('button', { name: 'Create and select' }))
  expect(screen.getByText(/title is required/i)).toBeTruthy()
  expect(createDocument).not.toHaveBeenCalled()
})
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `cd packages/admin && pnpm vitest run --mode=jsdom src/fields/relation/relation-create-view.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the view**

`FormProvider`'s real contract is `{ children, initialData, documentId,
collectionPath }` (`form-context.tsx:176-194`) — there is no `mode` or `fields` prop.
`collectionPath` **must** go on the provider: `image-field.tsx:64` reads it from form
context precisely so intermediate containers need not forward it, and without it the
upload widgets cannot reach the upload endpoint at all. `documentId` stays `null`,
which is what marks create mode for `upload.requireSavedDocument`.

```tsx
<FormProvider
  initialData={{}}
  documentId={null}
  collectionPath={targetCollectionPath}
>
  {/* the submission hook must sit BENEATH the provider — it reads field state */}
  <RelationCreateForm
    fields={targetDefinition.fields}
    adminConfig={targetAdminConfig ?? undefined}
    defaultContentLocale={defaultContentLocale}
    primaryActionLabel={primaryActionLabel}
    onCreated={onCreated}
  />
</FormProvider>
```

`RelationCreateForm` is an inner component that calls `useFormSubmission({ mode:
'create', fields, … })` and renders `<FormLayout regions={['main', 'sidebar']}
variant="stacked" />` plus the footer actions.

No `FormRenderer`, so no heading row, status bar, `DocumentActions`, path/tree/
available-locales widgets, concurrency notices or scheduling. Render the locale
notice when `parentActiveLocale !== defaultContentLocale`.

- [ ] **Step 4: Run and commit**

```bash
cd packages/admin && pnpm test
git add packages/admin/src/fields/relation/relation-create-view.tsx \
        packages/admin/src/fields/relation/relation-create-view.test.tsx
git commit -s -m "feat(admin): mounted the ordinary collection form in the relation creation view"
```

---

> ### ⏸ CHECKPOINT 5 — Embedded form integration
>
> Request review before starting Task 14. Scope: consistent server/service/receipt
> types, capability degradation, supported-caller opt-in, nested-creation
> suppression, provider context, parent content-locale propagation, real
> upload-widget behaviour, and picker state preservation.

### Phase 5 — Submission, receipts and failures

#### Task 14: Single-flight submission through the ordinary flow

**Files:**
- Modify: `packages/admin/src/fields/relation/relation-create-view.tsx`
- Test: `packages/admin/src/fields/relation/relation-create-submit.test.tsx`

- [ ] **Step 1: Write the failing tests**

```tsx
it('uploads with createDocument=false, then creates once', async () => {
  renderCreateView({ withPendingUpload: true })
  await click(screen.getByRole('button', { name: 'Create and select' }))
  expect(uploadField).toHaveBeenCalledWith('fixture', expect.anything(), false)
  expect(createDocument).toHaveBeenCalledTimes(1)
})

it('cannot launch parallel creates from repeated submits', async () => {
  renderCreateView({ slowCreate: true })
  const btn = screen.getByRole('button', { name: 'Create and select' })
  await Promise.all([click(btn), click(btn), pressEnterIn(screen.getByLabelText('Title'))])
  expect(createDocument).toHaveBeenCalledTimes(1)
})

it('never sends the parent active locale', async () => {
  renderCreateView({ parentActiveLocale: 'fr', defaultContentLocale: 'en' })
  await fillAndSubmit()
  expect(createDocument.mock.calls[0][0]).not.toHaveProperty('locale', 'fr')
})
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `cd packages/admin && pnpm vitest run --mode=jsdom src/fields/relation/relation-create-submit.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Wire `useFormSubmission` to `services.createDocument`**

Guard with the hook's own phase — `phase.kind !== 'idle'` disables the primary
action and ignores Enter. Record the receipt **before** any display read or
unmount, per the spec's step 4.

- [ ] **Step 4: Run and commit**

```bash
cd packages/admin && pnpm test
git add packages/admin/src/fields/relation
git commit -s -m "feat(admin): submitted embedded creation through the ordinary upload and create flow"
```

#### Task 15: Receipt handoff and display presentation state

**Files:**
- Create: `packages/admin/src/fields/relation/relation-display-state.ts`
- Modify: `relation-field.tsx:98-130`, `relation-many-field.tsx`
- Test: `packages/admin/src/fields/relation/relation-display-state.test.tsx`

**Interfaces:**
- Produces:
  ```ts
  export type DisplayState =
    | { kind: 'idle' } | { kind: 'loading' }
    | { kind: 'ready'; record: Record<string, unknown> }
    | { kind: 'unavailable'; retry: () => void }
  export interface RelationPresentation {
    display: DisplayState
    /** Structured committed-hook failure; survives hydration. Localised at render. */
    sideEffectFailure?: { phase: DocumentHookCommittedPhase; code: DocumentHookSideEffectCode }
    createdInLocale?: string
  }
  ```

Keyed by `targetDocumentId` **and** locale. A late response for a target that is no
longer selected must be discarded. None of this may be written into schema data.

- [ ] **Step 1: Write the failing tests**

```tsx
it('keeps the selection valid and retryable when hydration fails after the picker closes', async () => {
  const { relation } = await createAndSelectWithFailingHydration()
  expect(relation.value).toMatchObject({ targetDocumentId: 'd1', targetCollectionId: 'c1' })
  expect(screen.getByText('Media item created — details unavailable')).toBeTruthy()
  await click(screen.getByRole('button', { name: 'Retry loading details' }))
  expect(getDisplayRecord).toHaveBeenCalledTimes(2)
})

it('does not let a late response restore a removed selection', async () => {
  const { resolveLate } = await createSelectThenRemove()
  await resolveLate()
  expect(screen.queryByText(/details unavailable/i)).toBeNull()
})

it('retains the structured committed-hook failure through unmount and handoff', async () => {
  // Drive this from the REAL adapter output, not a hand-written fixture: run the host
  // create fn against a collection with a failing afterCreate hook and feed its actual
  // response in. A fabricated fixture passes even if the adapter's shape has drifted.
  const outcome = await realCreateWithFailingAfterCreateHook('media')
  await createWith(outcome)
  expect(receiptOf(outcome.documentId)).toMatchObject({
    outcome: 'committed-hook-failed',
    documentVersionId: expect.any(String),
    revision: expect.any(Number),
    sideEffectFailure: { phase: expect.any(String), code: expect.any(String) },
  })
  expect(screen.getByRole('status')).toHaveTextContent(/saved/i)   // localised from `code`
  expect(createDocument).toHaveBeenCalledTimes(1)
})
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `cd packages/admin && pnpm vitest run --mode=jsdom src/fields/relation/relation-display-state.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement, and move ownership to the parent field**

Extend the selection handoff so `RelationField` receives the receipt and seeds its
own presentation state, rather than relying on `selection.record`.

- [ ] **Step 4: Run and commit**

```bash
cd packages/admin && pnpm test
git add packages/admin/src/fields/relation
git commit -s -m "feat(admin): handed creation receipts and display state to the parent relation field"
```

#### Task 16: The failure matrix

**Files:**
- Test: `packages/admin/src/fields/relation/relation-create-failures.test.tsx`
- Modify: `relation-create-view.tsx` as each case drives out behaviour

Write one test per row of the spec's *Failures and recovery* table, in this order,
implementing minimally after each: validation failure, upload failure, definitive
pre-commit rejection, committed-hook failure, hydration failure, selection-apply
failure, indeterminate transport outcome.

- [ ] **Step 1: The two that are easiest to get wrong — write them first**

```tsx
it('shows an unconfirmed outcome as uncertain, not as a failure, and does not auto-retry', async () => {
  createDocument.mockRejectedValueOnce(new NetworkTimeout())
  await fillAndSubmit()
  expect(screen.getByText(/could not be confirmed/i)).toBeTruthy()
  expect(screen.queryByText(/not saved/i)).toBeNull()
  expect(createDocument).toHaveBeenCalledTimes(1)
})

it('keeps a saved result when applying the selection fails', async () => {
  applySelection.mockImplementationOnce(() => { throw new Error('boom') })
  await fillAndSubmit()
  expect(screen.getByRole('button', { name: 'Retry selection' })).toBeTruthy()
  expect(screen.queryByLabelText('Title')).toBeNull()  // not a fresh create form
})
```

```tsx
it('surfaces a path conflict without suffixing or resubmitting', async () => {
  createDocument.mockRejectedValueOnce(errPathConflict({ path: 'sunset' }))
  await fillAndSubmit({ title: 'Sunset' })
  expect(screen.getByText(/path .*already/i)).toBeTruthy()
  expect(screen.getByLabelText('Title')).toHaveValue('Sunset')  // values retained
  expect(createDocument).toHaveBeenCalledTimes(1)               // no automatic retry
})
```

- [ ] **Step 2: Run, implement each case, re-run until the file is green**

Run: `cd packages/admin && pnpm vitest run --mode=jsdom src/fields/relation/relation-create-failures.test.tsx`

- [ ] **Step 3: Commit**

```bash
git add packages/admin/src/fields/relation
git commit -s -m "feat(admin): handled every embedded creation failure outcome"
```

#### Task 17: `hasMany` capacity, ordering and deduplication

**Files:**
- Modify: `packages/admin/src/fields/relation/relation-many-field.tsx`
- Test: `packages/admin/src/fields/relation/relation-create-many.test.tsx`

- [ ] **Step 1: Write the failing tests**

```tsx
it('appends the created item once, preserving prior order, and shows it off-query', async () => {
  await selectRows(['a', 'b'])
  await createInPicker({ title: 'Zebra' })         // does not match the active query
  expect(pendingSelectionOrder()).toEqual(['a', 'b', 'd1'])
  expect(within(selectedItemsArea()).getByText(/Zebra|details unavailable/)).toBeTruthy()
  expect(within(resultsList()).queryByText('Zebra')).toBeNull()
})

it('refuses creation that would exceed maxItems and never rolls back a created document', async () => {
  renderMany({ maxItems: 1, value: [existing] })
  expect(screen.queryByRole('button', { name: /create/i })).toBeNull()
})
```

- [ ] **Step 2: Run, implement, re-run**

Run: `cd packages/admin && pnpm vitest run --mode=jsdom src/fields/relation/relation-create-many.test.tsx`

- [ ] **Step 3: Commit**

```bash
git add packages/admin/src/fields/relation
git commit -s -m "feat(admin): added capacity, ordering and dedupe rules to multi-relation creation"
```

---

> ### ⏸ CHECKPOINT 6 — Persistence and recovery
>
> Request review before starting Task 18. Scope: receipt retention before view
> transitions, single-select handoff, hydration retries after picker closure,
> committed-hook warnings, uncertain outcomes, selection-application failures, and
> multiple-selection capacity, ordering and deduplication.

### Phase 6 — Dismissal, focus, translations, docs

#### Task 18: Dirty-state dismissal and parent-guard coordination

**Files:**
- Modify: `relation-create-view.tsx`, `relation-picker.tsx`
- Test: `packages/admin/src/fields/relation/relation-create-dismissal.test.tsx`

- [ ] **Step 1: Write the failing tests**

```tsx
it('confirms discard on Back, Escape and backdrop, and one Escape never closes both layers', async () => {
  await dirtyTheCreateForm()
  await pressEscape()
  expect(screen.getByText(/discard/i)).toBeTruthy()
  expect(screen.getByRole('dialog', { name: /create media/i })).toBeTruthy()
})

it('leaves the parent dirty state, patches and blocker untouched when discarding the inner form', async () => {
  const before = parentFormSnapshot()
  await dirtyTheCreateForm(); await discard()
  expect(parentFormSnapshot()).toEqual(before)
})

it('disables Back and dismissal while a create is in flight', async () => {
  renderCreateView({ slowCreate: true })
  await submit()
  expect(screen.getByRole('button', { name: 'Back' })).toBeDisabled()
})

it('blocks route navigation when the parent is CLEAN and only the embedded form is dirty', async () => {
  renderNewsEditor({ dirty: false })
  await dirtyTheCreateForm()
  const blocked = await attemptRouteNavigation('/admin/collections/news')
  expect(blocked).toBe(true)
  expect(screen.getByText(/discard/i)).toBeTruthy()
})

it('arms beforeunload when only the embedded form is dirty', async () => {
  renderNewsEditor({ dirty: false })
  await dirtyTheCreateForm()
  const e = new Event('beforeunload', { cancelable: true })
  window.dispatchEvent(e)
  expect(e.defaultPrevented).toBe(true)
})

it('asks once, not twice, when both forms are dirty', async () => {
  renderNewsEditor({ dirty: true })
  await dirtyTheCreateForm()
  await attemptRouteNavigation('/admin/collections/news')
  expect(screen.getAllByRole('alertdialog')).toHaveLength(1)
})

it('re-arms the parent guard correctly after the embedded form is discarded', async () => {
  renderNewsEditor({ dirty: true })
  await dirtyTheCreateForm(); await discard()
  const blocked = await attemptRouteNavigation('/admin/collections/news')
  expect(blocked).toBe(true)          // parent is still dirty on its own
})
```

The fallback guard only handles `beforeunload`; client-side route blocking comes from
the injected adapter (`form-renderer.tsx:396`, prop > context > no-op). The embedded
form needs a guard that reports *its* dirty state into the same adapter the parent
uses, rather than installing a competing one.

- [ ] **Step 2: Run, implement, re-run**

Run: `cd packages/admin && pnpm vitest run --mode=jsdom src/fields/relation/relation-create-dismissal.test.tsx`

- [ ] **Step 3: Commit**

```bash
git add packages/admin/src/fields/relation
git commit -s -m "feat(admin): added dirty-state dismissal for the relation creation view"
```

#### Task 19: Focus ownership

**Files:**
- Modify: `relation-create-view.tsx`, `relation-picker.tsx`
- Test: `packages/admin/src/fields/relation/relation-create-focus.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
it('moves focus into the creation view, back to Create on Back, and to the relation control on close', async () => {
  await click(screen.getByRole('button', { name: 'Create media' }))
  expect(document.activeElement).toBe(screen.getByRole('heading', { name: /create media/i }))
  await click(screen.getByRole('button', { name: 'Back' }))
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Create media' }))
})

it('never focuses a control in a hidden view during busy recovery', async () => {
  await submitFromCreateViewThenReturnToSelect()
  expect(screen.getByRole('searchbox').closest('[hidden]')).toBeNull()
  expect(document.activeElement?.closest('[hidden]')).toBeFalsy()
})
```

- [ ] **Step 2: Run, implement, re-run, commit**

```bash
cd packages/admin && pnpm vitest run --mode=jsdom src/fields/relation/relation-create-focus.test.tsx
git add packages/admin/src/fields/relation
git commit -s -m "feat(admin): gave the relation creation view explicit focus ownership"
```

#### Task 20: Translations across all eight locales

**Files:**
- Modify: `packages/i18n/src/admin/{en,fr,de,es,it,ko,th,zh-CN}.json`
- Test: `packages/i18n/src/admin/index.test.node.ts` (existing parity test is the gate)

Keys required by the spec: create, back, createAndSelect, createAndAddToSelection,
independentPersistence, creationLocale, draftAvailability, discardConfirmation,
capacityLimit, savedWithWarning, detailsUnavailable, retryDetails, retrySelection,
unconfirmedOutcome. Parameterise collection label, status label and locale label.

- [ ] **Step 1: Add the keys to `en.json` first, then all seven others**

- [ ] **Step 2: Run the parity test**

Run: `cd packages/i18n && pnpm vitest run --mode=node src/admin/index.test.node.ts`
Expected: PASS — a missing key in any locale fails here.

- [ ] **Step 3: Commit**

```bash
git add packages/i18n/src/admin
git commit -s -m "feat(i18n): added embedded relation creation strings to all bundled locales"
```

#### Task 21: Browser verification

**Files:** none — this task produces a recorded result, not a committed spec.

Component tests mock `@byline/ui/react`'s `Modal`, so portal behaviour, real focus
trapping, real Escape ordering and real Enter handling are only observable in a
browser. There is no e2e suite: run these by hand against `pnpm dev`, or drive them
with the Claude-in-Chrome extension. Record what was exercised and observed in the
Checkpoint 7 handoff.

- [ ] **Scenario A — parent edits survive an embedded create**

1. Open a new news document. Fill **every required field** so the parent is valid —
   otherwise parent validation masks a wrongly-firing submit handler.
2. Type a distinctive title, e.g. `Unsaved headline`.
3. Open the feature-image picker, then **Create media**.
4. Fill the media form and press **Create and select**.
5. **Expected:** the tile appears, the news title still reads `Unsaved headline`, and
   the URL is still the new-document route. Confirm in the Network panel that exactly
   one create request fired, for `media`.

- [ ] **Scenario B — Enter in the embedded form never submits the parent**

1. Parent valid, as above. Open the creation view.
2. Filter the Network panel to `POST`. Focus the media **Title** field, press **Enter**.
3. **Expected:** the creation view stays open; **no** news mutation appears in Network;
   no save toast.

- [ ] **Scenario C — Escape ordering**

1. Open the creation view and make it dirty.
2. Press **Escape** once: the discard confirmation appears, creation view still visible
   behind it.
3. Press **Escape** again: the confirmation closes, the creation view remains.
4. **Expected:** one Escape never dismisses both layers.

- [ ] **Scenario D — focus containment**

With the creation view open, paste this, then press Tab ~30 times and Shift+Tab ~30
times:

```js
(() => {
  let escaped = null, i = 0
  const check = () => {
    i++
    if (!escaped && !document.activeElement?.closest('[role="dialog"]')) escaped = i
  }
  document.addEventListener('focusin', check, true)
  window.__focusReport = () => {
    document.removeEventListener('focusin', check, true)
    return escaped ? 'FAIL - escaped at move ' + escaped : 'PASS - contained across ' + i + ' moves'
  }
  return 'press Tab ~30x then Shift+Tab ~30x, then run window.__focusReport()'
})()
```

**Expected:** `PASS`. Then click **Back** and confirm focus returns to the **Create
media** control; close the picker and confirm focus returns to the relation control.

- [ ] **Scenario E — cross-form label and tab ownership**

Open a parent editor whose collection declares a tab set (`docs`), then open a creation
view for a target that **also** declares a tab set. Run the Task 7 Step 6 snippet with
both forms mounted.

**Expected:** all rows PASS, and `tab panels seen` counts at least two — otherwise the
assertion proved nothing, which is the failure mode this scenario exists to avoid.

#### Task 22: Documentation

**Files:**
- Modify: `docs/04-collections/03-relationships.md`
- Modify: `CLAUDE.md` (the `packages/admin` row, if the relation module gained files worth naming)

- [ ] **Step 1: Add a section to the relationships document**

Follow `docs/` house style: YAML front matter already exists; sentence-case
headings, em dashes, code-formatted paths, address the reader as "you". Cover what
embedded creation does, that the target is saved independently, that it creates in
the default content locale, and that media starts as Draft.

- [ ] **Step 2: Run the documentation gates**

Run: `pnpm docs:check && git diff --check`
Note: `docs:check` globs `../../docs/**/*.md` only — it does **not** validate
`specs/`. Check this plan's own links by hand if you edit it.

- [ ] **Step 3: Commit**

```bash
git add docs/04-collections/03-relationships.md
git commit -s -m "docs: documented embedded creation from relationship fields"
```

---

## Part II — final verification

- [ ] `pnpm byline:generate:check`
- [ ] `pnpm lint`
- [ ] `pnpm typecheck`
- [ ] `pnpm knip`
- [ ] `pnpm test`
- [ ] `pnpm test:integration`
- [ ] Task 21 browser scenarios A-E, run by hand or via the Claude-in-Chrome
      extension, with observed results recorded
- [ ] Walk the spec's *Acceptance criteria and verification* list and tick each line
      against a test that proves it.

> ### ⏸ CHECKPOINT 7 — Release readiness
>
> Request review after final verification, before merging. Scope: guard
> coordination, real-browser focus/Escape/Enter behaviour, meaningful cross-form
> label/tab assertions, translations, documentation, and the complete specification
> acceptance matrix. Review **both** the final incremental changes and the
> cumulative feature.

---

## Open decisions that gate implementation

These come from the spec's *Review decisions before implementation* table.

**All of Part I (Tasks 1–7, branch `refactor/forms`) is unblocked** — it is #94
extraction and concurrent-form correctness work that depends on no open decision, and
it merges to `develop` on its own merits.

**Part II starts partly blocked.** Tasks 8 and 9 are self-contained server changes and
are the first work once `feature/relation-create-new` exists — that is, after Part I
has merged into `develop`. They never run in parallel with Part I. **Task 10 is blocked** on the host
capability-surface decision below, since it fixes the exported names and the provider
placement. **Task 11 onward is blocked** until every row is settled — which is why
Checkpoint 4 sits immediately before Task 10.

| Decision | Blocks | Proposed baseline |
|---|---|---|
| Initial publication status (media starts Draft; public reads will not resolve it until activated) | Task 13 copy, Task 20 keys | Preserve ordinary lifecycle defaults and explain the consequence in the view |
| Creation locale experience for a parent editing a non-default locale | Task 13 notice, Task 20 keys | Create in the default locale and show "New documents are created in {locale}" |
| Omitted system controls (path derivation, advertised locales, tree placement) | Task 13 | Server derivation only; send no overrides; no tree placement |
| Host capability surface — exported names and provider placement | Task 10 | Three optional members on `BylineFieldServices` |
| Receipt and selection-handoff types | Tasks 11, 15 | `CreationReceipt` + `RelationPresentation` as defined above |

## Deviations from the spec

1. **Phase 1 is scoped to three #94 extractions**, not all six. The spec says store
   subscription changes and status-action cleanup are not prerequisites; this plan
   therefore omits them rather than restating them as optional.
2. **Task 17 (`hasMany`) is split out** from the spec's single "Multiple relations"
   section, because capacity/dedupe is independently reviewable from the
   receipt-handoff work in Task 15.
3. **Task 22 (docs) is included**, which the spec does not require. A user-visible
   editing affordance should not ship undocumented.
4. **The work is split across two branches**, which the spec does not specify. The spec
   sequences #94's extractions ahead of the feature but treats it as one effort.
   Separating `refactor/forms` from `feature/relation-create-new`, and merging the
   first to `develop` before starting the second, keeps a behaviour-preserving hot-path
   change bisectable on its own and lets Part I ship whether or not the feature
   proceeds. It changes no requirement in the spec, only the delivery shape.
