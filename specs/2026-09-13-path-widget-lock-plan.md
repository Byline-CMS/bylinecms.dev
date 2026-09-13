---
title: "Path widget lock — implementation plan"
path: "path-widget-lock-plan"
summary: "Sequence the configuration member, the two translation keys, the widget's read-only behaviour, the form-renderer forwarding and prop retype, and the documentation updates for CollectionAdminConfig.lockPath."
---

# Path widget lock — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give a collection one declared way to say its document paths are managed rather than editorial — `CollectionAdminConfig.lockPath: true` — and render the system path widget read-only, in both create and edit mode, when it does.

**Architecture:** One optional boolean on `CollectionAdminConfig` (`never` on `SingletonAdminConfig`), forwarded by `FormRenderer` to `PathWidget` as a second, independent prop alongside the existing `sourceLocked`. Inside the widget the lock folds into the existing read-only condition, so the placeholder preview, the "Regenerate from {source}" action, and the `readOnly` attribute all follow from one flag; the change handler gains a matching guard so the lock is not merely visual. Two new `byline-admin` translation keys carry the hints. Storage, transports, and server-side path policy are untouched.

**Spec:** [`./2026-09-13-path-widget-lock-spec.md`](./2026-09-13-path-widget-lock-spec.md) — read it before starting. The plan argues from the spec, and the spec's scope boundary (this is an admin guard, not URL immutability) governs every string and comment written here.

**Tech Stack:** TypeScript, React 19, Vitest (jsdom and node modes), Biome.

## Global Constraints

- **Biome only.** 2-space indent, single quotes, no semicolons, 100-char lines, trailing commas (ES5). Run `pnpm lint` before each commit. Never introduce ESLint or Prettier.
- **Commits** use conventional format, lowercase, past tense, single line, and `git commit -s` for the DCO sign-off. **The sign-off is the only permitted trailer** — no co-authorship, no AI attribution, no session trailer.
- **Additive configuration.** No collection changes behaviour unless it sets `lockPath`. Every existing row of the spec's behaviour matrix must still hold at the end.
- **`sourceLocked` keeps its present meaning and its present type.** It answers "can the form derive a preview". Do not redefine it, do not widen it to a union, do not infer the lock from a `counter` source or from `readOnly: true` on the source field.
- **The widget must never name a source concept.** No "serial number", no "counter", no "{field}" interpolation in either new string. Both new keys take zero parameters.
- **Never claim immutability.** `readOnly` stops an editor typing in the form. `params.path` on create, `updateDocumentSystemFields`, `@byline/client`, and migration scripts all remain able to set any path. Every comment, doc sentence, and hint string must stay true to that.
- **Read-only, not disabled.** The locked input renders `readOnly`, so editors can still select and copy the document's URL. Do not reach for `disabled`.
- **Target release 6.x.** The single break is the narrowed `FormRenderer` prop type — a release-note line, not a migration.
- **Keep implementation comments short.** A line or two on what the code does and why it is not obvious. The full rationale — the rejected inference alternative, the independence of `sourceLocked`, the scope boundary — belongs in the spec and in `docs/`, not restated in source. The comment blocks below are already written to that length; do not expand them.

## Findings from the spec review (read before Task 1)

The spec is sound and its code references were checked line by line against the working tree. Four things it does not say, which this plan carries:

1. **The validator needs a matching entry.** `packages/core/src/config/validate-admin-configs.ts:26-53` derives `CollectionOnlyAdminKey` from every `SingletonAdminConfig` member whose type excludes `undefined` to `never`, and `completeCollectionOnlyAdminKeys` brands the array with `__missingKeys` if one is absent. Adding `lockPath?: never` to `SingletonAdminConfig` therefore **breaks the `@byline/core` typecheck** until `'lockPath'` is added to `COLLECTION_ONLY_ADMIN_KEYS`. Task 1 does both, and gets the runtime rejection for untyped callers for free.
2. **The documentation target is `02-collections.md`, not `01-configuration.md`.** `docs/10-api-reference/01-configuration.md` covers `BaseConfig` / `AdminConfig` / `ServerConfig`. The per-collection admin surface is `docs/10-api-reference/02-collections.md` — the `CollectionAdminConfig` table at line 187 and the `SingletonAdminConfig` `never` table at line 345. `docs/04-collections/index.md:322-326` also enumerates the surface. Task 5 edits those three.
3. **Placeholder suppression is not automatic from `sourceLocked`.** A `lockPath` collection with an ordinary (non-counter, editable) source still computes `livePreview`, so it would show `Will be saved as "…"` next to the create hint. Folding the lock into `isReadOnly` — which already gates the placeholder and the regenerate button — is what makes the matrix's locked-create row true. Task 3 does it that way, which is why no separate gate appears.
4. **The "not merely visual" test needs a code change.** `handleChange` (`path-widget.tsx:128-136`) guards `disabled` only. A `readOnly` input ignores real typing, but a programmatic `change` event in jsdom still fires `onChange`, so the assertion fails without a guard. Task 3 guards on the combined read-only condition. That also covers the translation-locale case, which is inert in a browser and correct either way.

5. **The render gate hides the widget in the locked case that matters most.** The sidebar renders it only when `showPath && (useAsPath || initialData.path)`. A locked collection whose paths come from an external system declares no `useAsPath` and, on create, has nothing stored — so the widget vanishes at exactly the point the spec requires `Assigned automatically when this document is saved.` Since the spec makes `lockPath` independent of `useAsPath` *and* requires a locked widget to stay visible, the lock has to join the gate. Task 4 does that, with `showPath: false` still winning.

Two test-harness gotchas, both of which would otherwise produce tests that pass for the wrong reason:

- The `@byline/ui/react` `Input` mock in `form-renderer-capabilities.test.tsx:50-52` forwards only `name`, `value`, and `onChange`, so any assertion on `readOnly` fails until the mock passes it through. Task 4 extends it. `path-widget.test.tsx`'s own mock already spreads `...rest`.
- `path-widget.test.tsx`'s `render` helper collapses an explicit `useAsPath: undefined` to `'title'` via `??`, so the existing `no useAsPath` test (line 230) renders *with* a source and passes only because its `sourceValue` is empty. Task 3 replaces the fallback with an `in` check and gives that test a real source value.

Everything else in the spec verified as written: `FormAdminConfig` is used as a prop type in exactly two places (`form-renderer.tsx:136`, `use-form-layout.ts:53,93`), and every host-shell component that forwards `adminConfig` already types it as `CollectionAdminConfig` or `SingletonAdminConfig`, so the retype to `AdminResourceConfig` ripples nowhere inside the repository.

## File structure

**Modified — `@byline/core`:**

- `packages/core/src/@types/admin-types.ts` — `lockPath?: boolean` on `CollectionAdminConfig`, `lockPath?: never` on `SingletonAdminConfig`.
- `packages/core/src/config/validate-admin-configs.ts` — `'lockPath'` in `COLLECTION_ONLY_ADMIN_KEYS`.

**Modified — `@byline/i18n`:**

- `packages/i18n/src/admin/{en,fr,de,es,it,ko,th,zh-CN}.json` — `pathWidget.lockedCreateHint`, `pathWidget.lockedHint`.

**Modified — `@byline/admin`:**

- `packages/admin/src/forms/path-widget.tsx` — the `lockPath` prop and the read-only/hint/guard behaviour.
- `packages/admin/src/forms/form-renderer.tsx` — prop retype and forwarding.

**Modified — tests:**

- `packages/core/src/config/validate-admin-configs.test.node.ts`
- `packages/core/src/@types/singleton-admin-config.test.node.ts`
- `packages/admin/src/forms/path-widget.test.tsx`
- `packages/admin/src/forms/form-renderer-capabilities.test.tsx`

**Modified — docs:**

- `docs/04-collections/05-document-paths.md`, `docs/10-api-reference/02-collections.md`, `docs/04-collections/index.md`

No new files. No host-shell changes.

---

### Task 1: The configuration member

**Files:**
- Modify: `packages/core/src/@types/admin-types.ts` (`CollectionAdminConfig` ~line 302, `SingletonAdminConfig` ~line 509-515)
- Modify: `packages/core/src/config/validate-admin-configs.ts:45-53`
- Test: `packages/core/src/config/validate-admin-configs.test.node.ts`, `packages/core/src/@types/singleton-admin-config.test.node.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `CollectionAdminConfig.lockPath?: boolean`; `SingletonAdminConfig.lockPath?: never`. Task 4 reads it as `adminConfig?.lockPath` off `AdminResourceConfig`, typed `boolean | undefined`.

- [ ] **Step 1: Write the failing runtime test**

Append inside the singleton `describe` block in `packages/core/src/config/validate-admin-configs.test.node.ts`, directly after the existing `rejects list-only singleton options from untyped callers` test (line 88-97):

```ts
  it('rejects the collection-only lockPath option on a singleton from untyped callers', () => {
    const admin = {
      ...defineSingletonAdmin(singleton, {}),
      lockPath: true,
    } as unknown as AdminResourceConfig

    expect(() => validateAdminConfigs([admin], [collection, singleton])).toThrow(
      /lockPath.*not allowed on a singleton admin config/
    )
  })
```

- [ ] **Step 2: Write the failing type test**

Append inside the `describe('singleton admin config')` block in `packages/core/src/@types/singleton-admin-config.test.node.ts`, after `rejects collection-only admin options at the definition site`:

```ts
  it('rejects lockPath at the singleton definition site and accepts it on a collection', () => {
    defineSingletonAdmin(settings, {
      // @ts-expect-error — a singleton has no document path and no path widget.
      lockPath: true,
    })

    expect(defineAdmin(pages, { lockPath: true }).lockPath).toBe(true)
  })
```

- [ ] **Step 3: Run both to verify they fail**

Run: `cd packages/core && pnpm vitest run --mode=node src/config/validate-admin-configs.test.node.ts`
Expected: FAIL — `validateAdminConfigs` throws nothing, because no rule rejects `lockPath` on a singleton yet.

Run: `cd packages/core && pnpm typecheck`
Expected: FAIL on `defineAdmin(pages, { lockPath: true })` — an excess-property error, since `lockPath` is not yet a member of `CollectionAdminConfig`.

Vitest does not typecheck, so the type half of this task is verified by `pnpm typecheck` only — the same arrangement as the existing `rejects collection-only admin options at the definition site` test in that file. (The `@ts-expect-error` on the singleton line is satisfied both before and after the change: an excess property first, a `never`-typed member after.)

- [ ] **Step 4: Declare the member on `CollectionAdminConfig`**

In `packages/core/src/@types/admin-types.ts`, add to `CollectionAdminConfig` immediately after the `fields` member inherited discussion — place it after `preview` and before `listView` so it sits with the other form-affecting options:

```ts
  /**
   * Declares this collection's document paths managed — minted by the system
   * or an import rather than typed by an editor. The admin path widget then
   * renders read-only in both modes, with no preview or "Regenerate" action,
   * and renders even when the collection declares no `useAsPath`.
   *
   * An admin-interface guard only: it does not make the path immutable, and
   * it is independent of `useAsPath`. See
   * [Document paths](../../../docs/04-collections/05-document-paths.md).
   *
   * @default false
   */
  lockPath?: boolean
```

- [ ] **Step 5: Declare the `never` counterpart**

In `SingletonAdminConfig`, add to the trailing `never` block (which currently runs `columns` → `listActions`):

```ts
  /** A singleton has no document path and no path widget. */
  lockPath?: never
```

- [ ] **Step 6: Add the validator entry**

In `packages/core/src/config/validate-admin-configs.ts`, add `'lockPath'` to `COLLECTION_ONLY_ADMIN_KEYS`, after `'listActions'`:

```ts
const COLLECTION_ONLY_ADMIN_KEYS = completeCollectionOnlyAdminKeys([
  'columns',
  'defaultSort',
  'defaultColumns',
  'itemView',
  'itemViewSort',
  'listView',
  'listActions',
  'lockPath',
])
```

Without this the package will not typecheck: `completeCollectionOnlyAdminKeys` brands an incomplete array with `__missingKeys`.

- [ ] **Step 7: Run the tests and the typecheck**

Run: `cd packages/core && pnpm vitest run --mode=node src/config/validate-admin-configs.test.node.ts src/@types/singleton-admin-config.test.node.ts && pnpm typecheck`
Expected: PASS, and a clean typecheck.

- [ ] **Step 8: Lint and commit**

```bash
cd packages/core && pnpm lint
cd ../.. && git add packages/core/src/@types/admin-types.ts packages/core/src/config/validate-admin-configs.ts packages/core/src/config/validate-admin-configs.test.node.ts packages/core/src/@types/singleton-admin-config.test.node.ts
git commit -s -m "feat(core): added lockPath to the collection admin config"
```

---

### Task 2: The two translation keys

**Files:**
- Modify: `packages/i18n/src/admin/en.json`, `fr.json`, `de.json`, `es.json`, `it.json`, `ko.json`, `th.json`, `zh-CN.json` (all eight carry `pathWidget.readOnlyHint` on line 498)
- Test: `packages/i18n/src/admin/index.test.node.ts` (existing key-parity assertions — no new test needed)

**Interfaces:**
- Consumes: nothing.
- Produces: `pathWidget.lockedCreateHint` and `pathWidget.lockedHint` in the `byline-admin` namespace. Neither takes parameters. Task 3 resolves them via `t('pathWidget.lockedCreateHint')` / `t('pathWidget.lockedHint')`.

- [ ] **Step 1: Add both keys to English**

In `packages/i18n/src/admin/en.json`, insert after `"pathWidget.readOnlyHint"` (line 498), keeping the file's grouped — not alphabetical — key order:

```json
  "pathWidget.lockedCreateHint": "Assigned automatically when this document is saved.",
  "pathWidget.lockedHint": "This path is managed and cannot be edited here.",
```

- [ ] **Step 2: Run the parity test to verify it fails**

Run: `cd packages/i18n && pnpm vitest run --mode=node src/admin/index.test.node.ts`
Expected: FAIL — seven `exports the %s bundle with the same key set as en (no drift)` cases, plus the `fr` case, report the two missing keys.

- [ ] **Step 3: Translate into the other seven bundles**

Insert at the same position (after `"pathWidget.readOnlyHint"`, line 498) in each file.

`fr.json`:

```json
  "pathWidget.lockedCreateHint": "Attribué automatiquement lors de l'enregistrement de ce document.",
  "pathWidget.lockedHint": "Ce chemin est géré par le système et ne peut pas être modifié ici.",
```

`de.json`:

```json
  "pathWidget.lockedCreateHint": "Wird beim Speichern dieses Dokuments automatisch zugewiesen.",
  "pathWidget.lockedHint": "Dieser Pfad wird verwaltet und kann hier nicht bearbeitet werden.",
```

`es.json`:

```json
  "pathWidget.lockedCreateHint": "Se asigna automáticamente al guardar este documento.",
  "pathWidget.lockedHint": "Esta ruta está gestionada y no se puede editar aquí.",
```

`it.json`:

```json
  "pathWidget.lockedCreateHint": "Assegnato automaticamente al salvataggio di questo documento.",
  "pathWidget.lockedHint": "Questo percorso è gestito e non può essere modificato qui.",
```

`ko.json`:

```json
  "pathWidget.lockedCreateHint": "이 문서를 저장할 때 자동으로 할당됩니다.",
  "pathWidget.lockedHint": "이 경로는 시스템에서 관리되며 여기에서 편집할 수 없습니다.",
```

`th.json`:

```json
  "pathWidget.lockedCreateHint": "ระบบจะกำหนดโดยอัตโนมัติเมื่อบันทึกเอกสารนี้",
  "pathWidget.lockedHint": "พาธนี้ได้รับการจัดการโดยระบบและไม่สามารถแก้ไขได้ที่นี่",
```

`zh-CN.json`:

```json
  "pathWidget.lockedCreateHint": "保存此文档时自动分配。",
  "pathWidget.lockedHint": "此路径由系统管理，无法在此处编辑。",
```

- [ ] **Step 4: Run the parity test to verify it passes**

Run: `cd packages/i18n && pnpm test`
Expected: PASS, all bundles in key parity with English.

- [ ] **Step 5: Lint and commit**

```bash
cd packages/i18n && pnpm lint
cd ../.. && git add packages/i18n/src/admin
git commit -s -m "feat(i18n): added locked path-widget hints to the admin bundles"
```

---

### Task 3: The widget honours the lock

**Files:**
- Modify: `packages/admin/src/forms/path-widget.tsx`
- Test: `packages/admin/src/forms/path-widget.test.tsx`

**Interfaces:**
- Consumes: `pathWidget.lockedCreateHint`, `pathWidget.lockedHint` (Task 2).
- Produces: `PathWidgetProps.lockPath?: boolean`. Task 4 passes it as `lockPath={adminConfig?.lockPath}`.

- [ ] **Step 1: Extend the test render helper and fix its `useAsPath` fallback**

In `packages/admin/src/forms/path-widget.test.tsx`, add `lockPath` to the `render` helper's props type (after `sourceLocked: boolean`):

```tsx
      sourceLocked: boolean
      lockPath: boolean
    }> = {}
```

Then fix the `useAsPath` line and add the new prop on the `<PathWidget />` element. The current `props.useAsPath ?? 'title'` makes an explicit `undefined` unreachable, so `does not render the Regenerate button when there is no useAsPath` (line 230) actually renders with `useAsPath="title"` and passes only because its `sourceValue` is empty. Switch to an `in` check so absence is expressible:

```tsx
            useAsPath={'useAsPath' in props ? props.useAsPath : 'title'}
            collectionPath="pages"
            defaultLocale="en"
            activeLocale={props.activeLocale ?? 'en'}
            mode={props.mode ?? 'create'}
            slugifier={props.slugifier}
            sourceLocked={props.sourceLocked}
            lockPath={props.lockPath}
```

- [ ] **Step 2: Strengthen the now-genuine absent-source test**

With the fallback fixed, give that test a source value so it fails if `useAsPath` ever leaks back in:

```tsx
  it('does not render the Regenerate button when there is no useAsPath', () => {
    setFixture({ systemPath: 'whatever', sourceValue: 'Hello World' })
    render({ mode: 'edit', useAsPath: undefined })
    expect(container.querySelector('button')).toBeNull()
  })
```

Run: `cd packages/admin && pnpm vitest run --mode=jsdom src/forms/path-widget.test.tsx`
Expected: PASS. If it fails, the `in` check was not applied — the widget is deriving a preview from a source that should be absent.

- [ ] **Step 3: Pin the two unlocked hints the precedence rule is measured against**

Neither exists in the suite today, so "locked beats translation" and "locked beats validation" are otherwise unfalsifiable. Append inside `describe('PathWidget')`:

```tsx
  it('shows the translation-locale hint when editing a translation unlocked', () => {
    setFixture({ systemPath: 'my-path', sourceValue: 'My Path' })
    render({ mode: 'edit', activeLocale: 'fr' })

    const input = getInput()
    expect(input.readOnly).toBe(true)
    expect(container.querySelector('[data-testid="help-text"]')?.textContent).toBe(
      'Path is set in the default locale ("en") and applies across translations.'
    )
  })

  it('shows the suggested-slug hint for an un-slugified stored value', () => {
    setFixture({ systemPath: 'Not A Slug', sourceValue: 'My Path' })
    render({ mode: 'edit' })

    expect(getInput().readOnly).toBe(false)
    expect(container.querySelector('[data-testid="help-text"]')?.textContent).toBe(
      'Suggested: "not-a-slug"'
    )
  })
```

Run: `cd packages/admin && pnpm vitest run --mode=jsdom src/forms/path-widget.test.tsx`
Expected: PASS — both pin present behaviour.

- [ ] **Step 4: Write the failing tests**

Append inside the `describe('PathWidget')` block, after the two existing `sourceLocked` tests at the end of the file:

```tsx
  it('renders read-only and empty when creating in a locked collection', () => {
    setFixture({ systemPath: null, sourceValue: 'Hello World' })
    render({ mode: 'create', lockPath: true })

    const input = getInput()
    expect(input.readOnly).toBe(true)
    expect(input.value).toBe('')
    expect(input.getAttribute('placeholder')).toBeNull()
    expect(container.querySelector('button')).toBeNull()
    expect(container.querySelector('[data-testid="help-text"]')?.textContent).toBe(
      'Assigned automatically when this document is saved.'
    )
  })

  it('renders read-only and shows the stored path when editing a locked collection', () => {
    setFixture({ systemPath: 'catalogue-item', sourceValue: 'Hello World' })
    render({ mode: 'edit', lockPath: true })

    const input = getInput()
    expect(input.readOnly).toBe(true)
    expect(input.value).toBe('catalogue-item')
    // The stored path differs from what the source would derive, so an
    // unlocked widget would offer Regenerate here.
    expect(container.querySelector('button')).toBeNull()
    expect(container.querySelector('[data-testid="help-text"]')?.textContent).toBe(
      'This path is managed and cannot be edited here.'
    )
  })

  it('prefers the locked hint over the translation-locale hint', () => {
    setFixture({ systemPath: 'catalogue-item', sourceValue: 'Hello World' })
    render({ mode: 'edit', lockPath: true, activeLocale: 'fr' })

    expect(getInput().readOnly).toBe(true)
    expect(container.querySelector('[data-testid="help-text"]')?.textContent).toBe(
      'This path is managed and cannot be edited here.'
    )
  })

  it('ignores a change event while locked — the lock is not merely visual', () => {
    setFixture({ systemPath: 'catalogue-item', sourceValue: 'Hello World' })
    render({ mode: 'edit', lockPath: true })

    // Drive the input through the native prototype setter, exactly as the
    // two typing tests above do. A direct `input.value = …` updates React's
    // value tracker, which then suppresses onChange on its own — the
    // assertion below would pass whether or not the guard exists.
    const input = getInput()
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value'
      )?.set
      setter?.call(input, 'typed-over')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })

    expect(fixture.setSystemPath).not.toHaveBeenCalled()
  })

  it('leaves a counter-sourced collection editable when lockPath is not set', () => {
    // The explicit guard against reintroducing inference: a locked *source*
    // suppresses the preview and Regenerate, but never the input itself.
    setFixture({ systemPath: '0000448', sourceValue: 448 })
    render({ mode: 'edit', sourceLocked: true })

    const input = getInput()
    expect(input.readOnly).toBe(false)
    expect(container.querySelector('button')).toBeNull()
  })
```

- [ ] **Step 5: Run them to verify they fail**

Run: `cd packages/admin && pnpm vitest run --mode=jsdom src/forms/path-widget.test.tsx`
Expected: FAIL. The four locked cases fail on `readOnly` being `false` and on the help text (`Suggested: …` or nothing). The counter case already passes — it pins today's behaviour.

- [ ] **Step 6: Declare the prop**

In `packages/admin/src/forms/path-widget.tsx`, add to `PathWidgetProps` after `sourceLocked`:

```ts
  /**
   * When `true`, the collection declares its paths managed
   * (`CollectionAdminConfig.lockPath`): the input renders read-only in both
   * modes and the preview placeholder and "Regenerate" action are
   * suppressed. Independent of `sourceLocked`, which answers whether the
   * form can derive a preview at all. Defaults to `false`.
   */
  lockPath?: boolean
```

- [ ] **Step 7: Destructure it**

```ts
  sourceLocked = false,
  lockPath = false,
  disabled = false,
}: PathWidgetProps) => {
```

- [ ] **Step 8: Fold the lock into the read-only condition**

Replace the `isReadOnly` line (currently `path-widget.tsx:112`) and its comment with:

```ts
  // Phase 1: paths are written/edited only under the default content locale,
  // so editing a translation locks the widget down.
  const translationLocked = activeLocale !== defaultLocale

  // A collection may also declare its paths managed. Both conditions produce
  // the same read-only surface, so the placeholder, the Regenerate
  // affordance, the `readOnly` attribute and the change guard all key off the
  // combined flag.
  const isReadOnly = lockPath || translationLocked
```

- [ ] **Step 9: Guard the change handler**

```ts
  const handleChange = useCallback(
    (next: string) => {
      // `readOnly` stops real typing; a programmatic change event still
      // reaches this handler. Refuse the write so the lock holds in the form.
      if (disabled || isReadOnly) return
      // Empty string clears the override — server falls back to derive
      // (create) or sticky (update).
      setSystemPath(next.length === 0 ? null : next)
    },
    [disabled, isReadOnly, setSystemPath]
  )
```

- [ ] **Step 10: Order the hints**

Replace the `readOnlyHint` block (currently `path-widget.tsx:157-163`) with:

```ts
  // Hint precedence: locked, then translation, then live validation.
  const lockedHint = lockPath
    ? mode === 'create'
      ? t('pathWidget.lockedCreateHint')
      : t('pathWidget.lockedHint')
    : undefined

  const translationHint = translationLocked
    ? t('pathWidget.readOnlyHint', { locale: defaultLocale })
    : undefined

  const hint = lockedHint ?? translationHint ?? validationHint
```

Leave `placeholder`, `showRegenerate`, `srDescription`, and the `readOnly={isReadOnly}` attribute exactly as they are — each already keys off `isReadOnly`, which now carries the lock.

- [ ] **Step 11: Run the whole widget suite**

Run: `cd packages/admin && pnpm vitest run --mode=jsdom src/forms/path-widget.test.tsx`
Expected: PASS — the five locked cases, the two hint pins, and all twelve pre-existing tests.

- [ ] **Step 12: Prove the change guard is load-bearing**

The guard is the one piece of this task no rendering assertion can reach, so verify it by mutation rather than by reading the diff. Temporarily revert Step 9's condition to `if (disabled) return`, run the suite, and confirm `ignores a change event while locked` **fails** with `setSystemPath` called with `'typed-over'`. Restore the guard and confirm it passes again.

Run: `cd packages/admin && pnpm vitest run --mode=jsdom src/forms/path-widget.test.tsx -t 'not merely visual'`
Expected: FAIL with the guard removed, PASS with it restored. If it passes both ways, the test is driving the input wrongly — check that Step 4 used the native prototype setter and not a direct `input.value =` assignment.

- [ ] **Step 13: Lint, typecheck, commit**

```bash
cd packages/admin && pnpm lint && pnpm typecheck
cd ../.. && git add packages/admin/src/forms/path-widget.tsx packages/admin/src/forms/path-widget.test.tsx
git commit -s -m "feat(admin): rendered the path widget read-only for a locked collection"
```

---

### Task 4: Forwarding, visibility, and the prop retype

**Files:**
- Modify: `packages/admin/src/forms/form-renderer.tsx` (import block line 15, prop line 136, the sidebar render gate and `PathWidget` element ~line 955-967)
- Test: `packages/admin/src/forms/form-renderer-capabilities.test.tsx`

**Interfaces:**
- Consumes: `CollectionAdminConfig.lockPath` (Task 1), `PathWidgetProps.lockPath` (Task 3).
- Produces: `FormRendererProps.adminConfig?: AdminResourceConfig` — narrowed from `FormAdminConfig`.

**The visibility gap this task closes.** The sidebar currently renders the widget only when `showPath && (useAsPath || initialData.path)`. A locked collection whose paths arrive from an external system declares no `useAsPath`, and on create has no stored path yet — so the widget would be hidden at exactly the moment the spec says it must show `Assigned automatically when this document is saved.` The spec makes `lockPath` independent of `useAsPath` and requires a locked widget to stay visible; those two together mean the lock has to participate in the render gate, not just in the props. `showPath: false` still wins: it exists for a resource whose path is internal metadata and must never be presented.

- [ ] **Step 1: Let the test's `Input` mock forward `readOnly`**

In `packages/admin/src/forms/form-renderer-capabilities.test.tsx`, replace the `Input` entry of the `@byline/ui/react` mock (lines 50-52) with:

```tsx
    Input: ({ name, value, onChange, readOnly }: any) => (
      <input name={name} value={value ?? ''} onChange={onChange} readOnly={readOnly ?? false} />
    ),
```

- [ ] **Step 2: Write the failing tests**

Append inside `describe('FormRenderer capabilities')`, after `suppresses the path widget when showPath is false`:

```tsx
  it('forwards adminConfig.lockPath to the path widget', () => {
    render({ ...baseProps, adminConfig: { slug: 'pages', lockPath: true } })

    const input = container.querySelector<HTMLInputElement>('input[name="__systemPath__"]')
    expect(input?.readOnly).toBe(true)
    expect(input?.value).toBe('about-us')
  })

  it('leaves the path widget editable when no lockPath is declared', () => {
    render({ ...baseProps, adminConfig: { slug: 'pages' } })

    const input = container.querySelector<HTMLInputElement>('input[name="__systemPath__"]')
    expect(input?.readOnly).toBe(false)
  })

  it('keeps a counter source suppressing Regenerate without locking the input', () => {
    // `sourceLocked` and `lockPath` stay independent: a counter-sourced path
    // still has no derivable preview, but remains editable unless declared.
    // The source needs a real value whose slug ('448') differs from the
    // stored path ('about-us'), or Regenerate would be absent anyway and the
    // assertion would hold even if `sourceLocked` forwarding broke.
    render({
      ...baseProps,
      fields: [{ name: 'ref', label: 'Ref', type: 'counter' as const }],
      useAsPath: 'ref',
      initialData: { id: 'doc-1', path: 'about-us', fields: { ref: 448 } },
      adminConfig: { slug: 'pages' },
    })

    const input = container.querySelector<HTMLInputElement>('input[name="__systemPath__"]')
    expect(input?.readOnly).toBe(false)
    expect(container.querySelector('.byline-form-path-regenerate')).toBeNull()
  })

  it('renders the locked widget on create with no useAsPath and no stored path', () => {
    // A collection whose paths come from an external system declares no
    // `useAsPath` and has nothing stored yet — the case the old render gate
    // hid outright.
    render({
      ...baseProps,
      mode: 'create' as const,
      useAsPath: undefined,
      initialData: { fields: {} },
      adminConfig: { slug: 'pages', lockPath: true },
    })

    expect(container.querySelector('.byline-form-path')).not.toBeNull()
    const input = container.querySelector<HTMLInputElement>('input[name="__systemPath__"]')
    expect(input?.readOnly).toBe(true)
    expect(input?.value).toBe('')
  })

  it('keeps the widget hidden on create without useAsPath when unlocked', () => {
    render({
      ...baseProps,
      mode: 'create' as const,
      useAsPath: undefined,
      initialData: { fields: {} },
      adminConfig: { slug: 'pages' },
    })

    expect(container.querySelector('.byline-form-path')).toBeNull()
  })

  it('lets showPath: false override lockPath', () => {
    render({
      ...baseProps,
      showPath: false,
      adminConfig: { slug: 'pages', lockPath: true },
    })

    expect(container.querySelector('.byline-form-path')).toBeNull()
  })
```

- [ ] **Step 3: Run them to verify they fail**

Run: `cd packages/admin && pnpm vitest run --mode=jsdom src/forms/form-renderer-capabilities.test.tsx`
Expected: FAIL on two cases — `forwards adminConfig.lockPath` (`readOnly` is `false`, the flag is not forwarded) and `renders the locked widget on create with no useAsPath` (the element is absent, the render gate hides it). The other four pass as regression pins.

- [ ] **Step 4: Retype the prop**

In `packages/admin/src/forms/form-renderer.tsx`, swap the type import at line 15 (`FormAdminConfig` is used only for this prop; `use-form-layout.ts` keeps its own import):

```ts
  AdminResourceConfig,
```

and change line 136:

```ts
  /**
   * Presentation configuration for the resource being edited — a collection
   * or a singleton. Typed as the union rather than the shared
   * `FormAdminConfig` base so the renderer can read collection-only members
   * such as `lockPath`.
   */
  adminConfig?: AdminResourceConfig
```

- [ ] **Step 5: Admit the lock to the render gate**

In the sidebar block (currently `form-renderer.tsx:955-957`), replace the condition with:

```tsx
              {/* A locked collection's widget renders even with no `useAsPath`
                  and nothing stored yet: its path is managed, and the editor
                  needs to see that. `showPath: false` still wins — it marks a
                  path that must never be presented at all. */}
              {showPath &&
                (useAsPath ||
                  adminConfig?.lockPath === true ||
                  (typeof initialData?.path === 'string' && initialData.path.length > 0)) && (
```

- [ ] **Step 6: Forward the flag**

In the `PathWidget` element, add the prop after `sourceLocked`:

```tsx
                    sourceLocked={pathSourceLocked}
                    lockPath={adminConfig?.lockPath}
```

Do not touch `pathSourceLocked` or its `useMemo` — the two stay independent.

- [ ] **Step 7: Run the admin suites and the typecheck**

Run: `cd packages/admin && pnpm test && pnpm typecheck`
Expected: PASS in both jsdom and node modes.

- [ ] **Step 8: Verify the retype ripples nowhere**

Run: `pnpm typecheck`
Expected: PASS across the workspace. Every in-repo caller already passes a full `CollectionAdminConfig` or `SingletonAdminConfig`; a failure here means a caller was passing a bare base object and needs reporting, not silencing with a cast.

- [ ] **Step 9: Lint and commit**

```bash
cd packages/admin && pnpm lint
cd ../.. && git add packages/admin/src/forms/form-renderer.tsx packages/admin/src/forms/form-renderer-capabilities.test.tsx
git commit -s -m "feat(admin): forwarded lockPath to the path widget and kept a locked widget visible"
```

---

### Task 5: Documentation

**Files:**
- Modify: `docs/04-collections/05-document-paths.md` (the `## The path widget` section, line 178-193)
- Modify: `docs/10-api-reference/02-collections.md` (the `CollectionAdminConfig` table at line 187, the `SingletonAdminConfig` `never` table at line 345)
- Modify: `docs/04-collections/index.md` (the `### The CollectionAdminConfig surface` paragraph, line 322-326)

**Interfaces:**
- Consumes: the behaviour shipped in Tasks 1-4.
- Produces: nothing consumed by code.

House style applies: front matter `title` matches the H1, concrete actors ("Byline's admin user interface", "the server"), the reader addressed as "you", no metaphors, claims verified against the code.

- [ ] **Step 1: Document the lock in the path-widget reference**

In `docs/04-collections/05-document-paths.md`, in the `Behaviour:` list of `## The path widget`, append after the `**Live validation hint**` bullet:

```markdown
- **Locked collections** — a collection whose admin configuration sets `lockPath: true` declares its paths managed: minted by the system or by an import rather than typed by an editor. The input then renders read-only in both create and edit mode, the placeholder preview and the "Regenerate" action are suppressed, and a fixed hint explains the state — `Assigned automatically when this document is saved.` before the first save, `This path is managed and cannot be edited here.` afterwards. A locked collection edited in a translation locale shows the managed-path hint rather than the translation one. The widget stays visible throughout, because editors still need to read and copy the document's URL; a locked collection renders it even when the collection declares no `useAsPath`, which is the ordinary shape when an external system assigns the paths. The `showPath` renderer option still suppresses the widget outright.
```

- [ ] **Step 2: State the scope boundary**

Immediately below that list, before the paragraph beginning `The widget bypasses the patch system`, add:

```markdown
`lockPath` protects the admin form and nothing else. It does not make a path immutable: `params.path` on create, `updateDocumentSystemFields`, `@byline/client`, and migration scripts can all still set any path, which is what an installation's import scripts rely on. Rules about how paths are created and changed are the installation's responsibility, enforced by whichever subsystem already manages those paths — Byline cannot know a given site's URL contract. One consequence is worth planning for: a locked collection has no admin route to correct a bad path, so a correction moves to a script or the client SDK.
```

- [ ] **Step 3: Add the API-reference rows**

In `docs/10-api-reference/02-collections.md`, add to the `CollectionAdminConfig` table, after the `preview` row:

```markdown
| `lockPath` | `false` | Declares the collection's document paths managed, rendering the admin path widget read-only in both modes and keeping it visible even with no `useAsPath`. An admin-interface guard only — every programmatic write path can still set any path. |
```

and to the `SingletonAdminConfig` `never` table, after the `listActions` row:

```markdown
| `lockPath` | `never` | Collection path-widget option. A singleton has no document path. |
```

- [ ] **Step 4: Add it to the surface summary**

In `docs/04-collections/index.md`, amend the `### The CollectionAdminConfig surface` paragraph so the sentence reads:

```markdown
The major areas are `columns` and `defaultSort` for the list view; `itemView`
and `itemViewSort` for compact document rows; `tabSets`, `rows`, `groups`, and
`layout` for edit-form composition; `preview` for public preview URLs;
`lockPath` for collections whose paths are managed rather than edited; and
`listView` / `listActions` for list-level extensions. Per-field presentation
lives in `fields`.
```

- [ ] **Step 5: Verify the documentation**

Run: `pnpm docs:check && git diff --check`
Expected: PASS, no trailing-whitespace or conflict-marker warnings.

- [ ] **Step 6: Commit**

```bash
git add docs/04-collections/05-document-paths.md docs/10-api-reference/02-collections.md docs/04-collections/index.md
git commit -s -m "docs: documented the lockPath admin guard for document paths"
```

---

## Verification summary

Run the full CI gate set before opening the pull request — the same commands, in the same order, that `.github/workflows/ci.yml` runs:

```bash
pnpm byline:generate:check
pnpm docs:check
pnpm lint
pnpm typecheck
pnpm knip
pnpm knip:exports
pnpm test
```

`byline:generate:check` should be a no-op here — no collection schema changes — but it gates CI, so a diff in generated types means something unexpected moved. `knip` and `knip:exports` check for unused exported symbols against a baseline; adding an interface member does not itself move that baseline, so neither should report anything. If one does, read the finding before reaching for `pnpm knip:exports:update` — a new entry usually means something was exported and left unwired, not that the baseline is stale.

`pnpm test:integration` is not required: nothing in this work touches storage, transports, or the database.

Then check the spec's behaviour matrix by hand in the admin interface, with one collection temporarily set to `lockPath: true`:

1. Locked, create — the input is read-only and empty, no placeholder, no Regenerate, create hint shown.
2. Locked, create, collection with no `useAsPath` — the widget still renders, read-only, with the create hint.
3. Locked, edit, source locale — read-only, stored path visible and selectable, no Regenerate, managed hint shown.
4. Locked, edit, translation locale — read-only, managed hint (not the translation hint).
5. Unlocked, counter source — still editable, Regenerate still absent.
6. Unlocked, ordinary source — placeholder preview, Regenerate, typing, and the `Suggested:` hint all behave as before.
7. Unlocked, translation locale — read-only with the translation hint, unchanged.
8. Switch the admin interface to French and confirm both new hints render translated.

Release note for 6.x: `FormRenderer`'s `adminConfig` prop narrowed from `FormAdminConfig` to `AdminResourceConfig`. Every in-repo caller already passes a full collection or singleton configuration; an external caller handing `FormRenderer` a bare base object gets a type error and should pass the resource configuration it already has.
