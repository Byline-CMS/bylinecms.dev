---
title: "Richtext extension node ownership — implementation plan"
path: "richtext-node-ownership-plan"
summary: "Sequence the implementation and verification of extension-owned node registration, the capability and preference split, and targeted JSON normalization on editor load."
---

# Richtext extension node ownership — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a Lexical field's resolved editor decide which structures the field accepts, and adapt existing content on editor load instead of failing. `editorConfig.extensions` controls optional features; the resolved editor's registered node types are the authority on what the field accepts, comprising those features, everything they pull in transitively, and mandatory infrastructure such as `CoreNodesExtension`.

**Architecture:** Node registration moves out of a blanket array in the editor root and into the extensions that own each node. Controls and Markdown transformers then derive from the node types actually registered on the editor. Saved content containing a now-unsupported structure is converted by a targeted rewrite of the serialized JSON tree, which copies supported nodes' own properties and converts only the unsupported ones.

**Tech Stack:** TypeScript, React 19, Lexical 0.50.0 (pinned exactly), Vitest (jsdom and node modes), Biome.

**Spec:** [`./2026-09-11-richtext-node-ownership-spec.md`](./2026-09-11-richtext-node-ownership-spec.md) — read it before starting. The plan argues from the spec.

## Global Constraints

- Lexical is pinned to exactly `0.50.0` across every `@lexical/*` package. Never change a Lexical version in this work.
- Biome only. 2-space indent, single quotes, no semicolons, 100-char lines, trailing commas (ES5). Run `pnpm lint` before each commit.
- Target release is 6.0. The configuration change is a clean break with **no deprecated alias** for the old `options` record.
- Byline does **not** adopt `@lexical/rich-text`'s `RichTextExtension`. It binds heading and quote registration to general rich-text behaviour and would reproduce the defect.
- Byline does **not** wire up `ClipboardDOMImportExtension` or the `DOMImportExtension` rules pipeline. The legacy `$generateNodesFromDOM` paste path is a load-bearing assumption of this work.
- Normalization never mutates its input. It builds a new JSON tree and leaves the form's original value and any cached document untouched.
- Conversions are explicit and apply only to declared types. Never apply generic child-unwrapping to an unknown or custom node type.
- Formatting that shares `TextNode` — bold, italic, inline code — cannot be constrained by this work. Never write a comment, type doc, or message implying otherwise.
- Commits use conventional format, lowercase, past tense, and `git commit -s` for the DCO sign-off. The sign-off is the only permitted trailer — no co-authorship, no AI credit, no session trailer.
- **No Playwright and no automated end-to-end tests.** Every test in this plan is a unit or jsdom test. Where behaviour can only be confirmed in a real browser — the adapted notice, the read-only refusal surface, the migrated downstream registrations — ask the repository owner to check it by hand and record what they confirmed. Do not add an e2e suite for this work.
- React components are tested with `createRoot` + `act` and `vi.mock` for CSS, following `editor-component.test.tsx` and `@byline/admin`'s form tests. `@testing-library/react` is not a dependency of this repository; do not add it.
- jsdom mounts of the real editor need `test-support/jsdom-setup.ts` (stubs `window.matchMedia` and `ResizeObserver`) and a registered admin config via `defineAdminConfig`.

## Decision: the scanner's configuration source

The scanner must know which node types each field supports, but field configuration is client-side and React-bearing. This was measured: `npx tsx -e "import('./byline/admin.config.ts')"` fails with `Unknown file extension ".css"`, so a Node script cannot simply import it.

The scanner is therefore split at a manifest boundary. `byline/scripts/richtext-capabilities.ts` runs where the client config already loads and writes a JSON manifest of field path to supported node types. `byline/scripts/richtext-scan.ts` is plain Node, reads that manifest and the database, and reports affected documents. Task 16 tries a CSS-stubbing loader for the first script and falls back to a dev-only admin route that downloads the manifest if module-scope browser access defeats it. The manifest boundary holds either way, and the scanning logic stays testable without a browser.

## File structure

**New, in `packages/richtext-lexical/src/field/`:**

- `capabilities/registered-node-types.ts` — the one place that reads `editor._nodes`; resolves the registered type-string set.
- `capabilities/filter-transformers.ts` — drops Markdown transformers whose node dependencies are unregistered.
- `extensions/heading/heading-extension.ts`, `extensions/quote/quote-extension.ts` — removable heading and quote ownership.
- `extensions/core-nodes/core-nodes-extension.ts` — always-on `MarkNode` and `OverflowNode`.
- `normalize/declared-conversions.ts` — the conversion table as data, one entry per supported structure.
- `normalize/normalize-value.ts` — the immutable tree rewrite and its `NormalizeResult`.
- `normalize/adapted-notice.tsx` — the notice and the read-only refusal surface.
- `scan/capability-manifest.ts`, `scan/scan-documents.ts` — manifest production and pure scanning logic.
- `test-support/build-test-editor.ts` — shared jsdom editor builders.

**Modified:** `editor-context.tsx`, `apply-value-plugin.tsx`, `editor.tsx`, `nodes/index.ts`, `markdown/transformers.ts`, `plugins/toolbar-plugin/index.tsx`, `config/{types,default,default-extensions,built-in-extension-names,resolve-editor-config}.ts`, and the downstream registrations in `apps/webapp/byline/`.

---

### Task 1: Test harness foundation

Nothing else can be verified without this. `@lexical/html` and `@lexical/clipboard` do not resolve from the package today, the package's jsdom mode has no React plugin so `.tsx` fails to transform, and every later task needs the same two editor builders.

**Files:**
- Modify: `packages/richtext-lexical/package.json` (devDependencies)
- Modify: `packages/richtext-lexical/vitest.config.ts`
- Create: `packages/richtext-lexical/src/field/test-support/build-test-editor.ts`
- Test: `packages/richtext-lexical/src/field/test-support/build-test-editor.test.tsx`

**Interfaces:**
- Produces: `buildFullEditor(): LexicalEditorWithDispose` — every default extension.
  `buildRestrictedEditor(removals?: string[]): LexicalEditorWithDispose` — defaults minus the named extensions; defaults to removing every `builtInExtensions` entry plus `@lexical/list/List` and `@lexical/list/CheckList`.
  `parseHtmlToTypes(editor, html): { types: string[]; text: string }`.

- [ ] **Step 1: Add the development dependencies**

```bash
cd packages/richtext-lexical
pnpm add -D @lexical/html@0.50.0 @lexical/clipboard@0.50.0
```

Both must be exactly `0.50.0`. They are development-only: no runtime import may reference them.

- [ ] **Step 2: Give jsdom mode a React transform**

`vitest.config.ts` currently registers no plugins, and the package's `tsconfig.json` sets `jsx: "preserve"`, so any test importing a `.tsx` extension fails with "content contains invalid JS syntax". Add the plugin to jsdom mode only:

```ts
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig(({ mode }) => {
  const testFiles =
    mode === 'node'
      ? ['**/*.test.node.ts', '**/*.test.node.tsx']
      : ['**/*.test.ts', '**/*.test.tsx']

  return {
    plugins: mode === 'node' ? [] : [react()],
    test: {
      environment: mode === 'node' ? 'node' : 'jsdom',
      include: testFiles,
      reporter: 'verbose',
      globals: true,
    },
  }
})
```

- [ ] **Step 3: Write the builders**

`ReactPluginHostExtension` is required: several default extensions host React decorators and `buildEditorFromExtensions` throws "No ReactProviderExtension detected" without it.

```ts
import { buildEditorFromExtensions } from '@lexical/extension'
import { $generateNodesFromDOM } from '@lexical/html'
import { ReactPluginHostExtension } from '@lexical/react/ReactPluginHostExtension'
import { defineExtension, type LexicalEditor } from 'lexical'

import { builtInExtensions } from '../config/built-in-extension-names'
import { defaultExtensionsList } from '../config/default-extensions'

const NAMESPACE = 'LexicalRichText'

export function buildFullEditor() {
  return buildEditorFromExtensions(
    defineExtension({
      name: '[test-root]',
      namespace: NAMESPACE,
      dependencies: [ReactPluginHostExtension, ...defaultExtensionsList().toArray()],
    })
  )
}

export function buildRestrictedEditor(removals?: string[]) {
  const names = removals ?? [
    ...Object.values(builtInExtensions),
    '@lexical/list/List',
    '@lexical/list/CheckList',
  ]
  const list = defaultExtensionsList()
  for (const name of names) list.remove(name)
  return buildEditorFromExtensions(
    defineExtension({
      name: '[test-root]',
      namespace: NAMESPACE,
      dependencies: [ReactPluginHostExtension, ...list.toArray()],
    })
  )
}

export function parseHtmlToTypes(editor: LexicalEditor, html: string) {
  const dom = new DOMParser().parseFromString(html, 'text/html')
  let result = { types: [] as string[], text: '' }
  editor.update(
    () => {
      const nodes = $generateNodesFromDOM(editor, dom)
      result = {
        types: nodes.map((node) => node.getType()),
        text: nodes.map((node) => node.getTextContent()).join('|'),
      }
    },
    { discrete: true }
  )
  return result
}
```

- [ ] **Step 4: Write the test that proves the harness works**

```tsx
import { describe, expect, it } from 'vitest'

import { buildFullEditor, buildRestrictedEditor, parseHtmlToTypes } from './build-test-editor'

describe('test harness', () => {
  it('builds the full default extension set', () => {
    const editor = buildFullEditor()
    expect(parseHtmlToTypes(editor, '<p>hello</p>').types).toEqual(['paragraph'])
    editor.dispose()
  })

  it('builds a restricted editor', () => {
    const editor = buildRestrictedEditor()
    expect(parseHtmlToTypes(editor, '<p>hello</p>').types).toEqual(['paragraph'])
    editor.dispose()
  })
})
```

- [ ] **Step 5: Run the tests**

Run: `cd packages/richtext-lexical && pnpm vitest run --mode=jsdom src/field/test-support/build-test-editor.test.tsx`
Expected: PASS, both tests.

- [ ] **Step 6: Commit**

```bash
git add packages/richtext-lexical/package.json packages/richtext-lexical/vitest.config.ts packages/richtext-lexical/src/field/test-support/ pnpm-lock.yaml
git commit -s -m "test(richtext): added a jsdom harness for extension-graph editors"
```

---

### Task 2: Resolve the registered node types

Everything that must "follow resolved capabilities" needs one honest answer to "which node types does this editor actually accept". Lexical exposes `hasNode(klass)` publicly but offers no way to enumerate registered type strings, so this task contains the single access to `editor._nodes`, which is declared on the public `LexicalEditor` type.

**Files:**
- Create: `packages/richtext-lexical/src/field/capabilities/registered-node-types.ts`
- Test: `packages/richtext-lexical/src/field/capabilities/registered-node-types.test.tsx`

**Interfaces:**
- Consumes: `buildFullEditor`, `buildRestrictedEditor` from Task 1.
- Produces: `registeredNodeTypes(editor: LexicalEditor): ReadonlySet<string>` and `supportsNodeType(editor: LexicalEditor, type: string): boolean`.

- [ ] **Step 1: Write the failing test**

```tsx
import { HeadingNode } from '@lexical/rich-text'
import { describe, expect, it } from 'vitest'

import { buildFullEditor, buildRestrictedEditor } from '../test-support/build-test-editor'
import { registeredNodeTypes, supportsNodeType } from './registered-node-types'

describe('registeredNodeTypes', () => {
  it('always reports the core types', () => {
    const editor = buildRestrictedEditor()
    const types = registeredNodeTypes(editor)
    expect(types.has('root')).toBe(true)
    expect(types.has('paragraph')).toBe(true)
    expect(types.has('text')).toBe(true)
    editor.dispose()
  })

  it('agrees with hasNode for a class the editor registers', () => {
    const editor = buildFullEditor()
    expect(editor.hasNode(HeadingNode)).toBe(supportsNodeType(editor, 'heading'))
    editor.dispose()
  })

  it('reports a type as unsupported once its extension is removed', () => {
    const editor = buildRestrictedEditor()
    expect(supportsNodeType(editor, 'table')).toBe(false)
    expect(supportsNodeType(editor, 'link')).toBe(false)
    editor.dispose()
  })
})
```

Note: this test asserts `heading` is registered in the full editor. That only becomes true in Task 3. Until then the second case documents the agreement between the two APIs, which holds whichever way `hasNode` answers.

- [ ] **Step 2: Run it to watch it fail**

Run: `cd packages/richtext-lexical && pnpm vitest run --mode=jsdom src/field/capabilities/registered-node-types.test.tsx`
Expected: FAIL — cannot resolve `./registered-node-types`.

- [ ] **Step 3: Implement it**

```ts
import type { LexicalEditor } from 'lexical'

/**
 * The set of node type strings this editor accepts.
 *
 * This is the ONLY place in Byline that reads `editor._nodes`. Lexical
 * declares the property on the public `LexicalEditor` type but exposes no
 * way to enumerate registered type strings — `hasNode` answers only for a
 * class you already hold, and the normalizer works from serialized JSON
 * where all it has is the type string. Keep the access here so a future
 * Lexical change has one site to fix.
 */
export function registeredNodeTypes(editor: LexicalEditor): ReadonlySet<string> {
  return new Set(editor._nodes.keys())
}

export function supportsNodeType(editor: LexicalEditor, type: string): boolean {
  return editor._nodes.has(type)
}
```

- [ ] **Step 4: Run the tests**

Run: `cd packages/richtext-lexical && pnpm vitest run --mode=jsdom src/field/capabilities/registered-node-types.test.tsx`
Expected: PASS, three tests.

- [ ] **Step 5: Commit**

```bash
git add packages/richtext-lexical/src/field/capabilities/
git commit -s -m "feat(richtext): resolved registered node types from the editor"
```

---

### Task 3: Heading and quote extensions

`HeadingNode` and `QuoteNode` lose their only registration when the blanket array goes. They get Byline-authored owners rather than upstream's `RichTextExtension`, so a field can enable headings without quotes, or neither, while keeping ordinary rich-text behaviour.

**Files:**
- Create: `packages/richtext-lexical/src/field/extensions/heading/heading-extension.ts`
- Create: `packages/richtext-lexical/src/field/extensions/quote/quote-extension.ts`
- Modify: `packages/richtext-lexical/src/field/config/built-in-extension-names.ts`
- Modify: `packages/richtext-lexical/src/field/config/default-extensions.ts`
- Test: `packages/richtext-lexical/src/field/extensions/heading/heading-extension.test.tsx`

**Interfaces:**
- Produces: `HeadingExtension`, `QuoteExtension`, and the `builtInExtensions.Heading` / `builtInExtensions.Quote` name strings.

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, expect, it } from 'vitest'

import { builtInExtensions } from '../../config/built-in-extension-names'
import { buildFullEditor, buildRestrictedEditor, parseHtmlToTypes } from '../../test-support/build-test-editor'

describe('heading and quote ownership', () => {
  it('imports headings and quotes when both extensions are present', () => {
    const editor = buildFullEditor()
    expect(parseHtmlToTypes(editor, '<h1>Title</h1>').types).toEqual(['heading'])
    expect(parseHtmlToTypes(editor, '<blockquote>Quoted</blockquote>').types).toEqual(['quote'])
    editor.dispose()
  })

  it('degrades a pasted heading to a paragraph and keeps the text', () => {
    const editor = buildRestrictedEditor([builtInExtensions.Heading])
    const result = parseHtmlToTypes(editor, '<h1>Pasted title</h1>')
    expect(result.types).toEqual(['paragraph'])
    expect(result.text).toBe('Pasted title')
    editor.dispose()
  })

  it('keeps headings while quotes are removed', () => {
    const editor = buildRestrictedEditor([builtInExtensions.Quote])
    expect(parseHtmlToTypes(editor, '<h1>Title</h1>').types).toEqual(['heading'])
    expect(parseHtmlToTypes(editor, '<blockquote>Quoted</blockquote>').types).toEqual(['paragraph'])
    editor.dispose()
  })
})
```

- [ ] **Step 2: Run it to watch it fail**

Run: `cd packages/richtext-lexical && pnpm vitest run --mode=jsdom src/field/extensions/heading/`
Expected: FAIL — `builtInExtensions.Heading` is undefined, so `buildRestrictedEditor` cannot remove it.

Note what these tests do **not** prove. `buildFullEditor` and `buildRestrictedEditor` compose their own root extension and never include the production blanket array, which lives only in `editor-context.tsx:100`. So once the names exist these pass immediately, and they say nothing about the defect in the shipped component. Task 5 carries a separate regression test that mounts the real component; do not treat a green run here as evidence the defect is fixed.

- [ ] **Step 3: Write the extensions**

`heading-extension.ts`:

```ts
import { HeadingNode } from '@lexical/rich-text'
import { defineExtension } from 'lexical'

/**
 * Owns `HeadingNode`.
 *
 * Byline deliberately does not adopt `@lexical/rich-text`'s
 * `RichTextExtension` for this. That extension binds heading and quote
 * registration to general rich-text behaviour, so adopting it would
 * register headings in every rich-text field and a field configured
 * without headings would still accept them from a paste.
 */
export const HeadingExtension = defineExtension({
  name: '@byline/richtext-lexical/Heading',
  nodes: () => [HeadingNode],
})
```

`quote-extension.ts` is the same shape with `QuoteNode` and the name `@byline/richtext-lexical/Quote`.

- [ ] **Step 4: Register the names and add both to the defaults**

In `built-in-extension-names.ts`, add to the `builtInExtensions` object, keeping alphabetical order:

```ts
  Heading: '@byline/richtext-lexical/Heading',
```

and

```ts
  Quote: '@byline/richtext-lexical/Quote',
```

In `default-extensions.ts`, import both and add them to `defaultExtensionsArray()` in the block- and list-level group, immediately before `ListExtension`:

```ts
    // Block-level text structures.
    HeadingExtension,
    QuoteExtension,
```

- [ ] **Step 5: Run the tests**

Run: `cd packages/richtext-lexical && pnpm vitest run --mode=jsdom src/field/extensions/heading/`
Expected: PASS, all three cases — the harness never had the blanket array to begin with. The production path is still broken at this point, which Task 5 proves and fixes.

- [ ] **Step 6: Commit**

```bash
git add packages/richtext-lexical/src/field/extensions/heading/ packages/richtext-lexical/src/field/extensions/quote/ packages/richtext-lexical/src/field/config/
git commit -s -m "feat(richtext): added removable heading and quote extensions"
```

---

### Task 4: Core nodes extension

`MarkNode` and `OverflowNode` belong to no feature a field can switch off, so they need an always-on owner rather than a removable one.

**Files:**
- Create: `packages/richtext-lexical/src/field/extensions/core-nodes/core-nodes-extension.ts`
- Modify: `packages/richtext-lexical/src/field/editor-context.tsx` — inject at the root
- Modify: `packages/richtext-lexical/src/field/test-support/build-test-editor.ts` — mirror the injection
- Test: `packages/richtext-lexical/src/field/extensions/core-nodes/core-nodes-extension.test.tsx`

**Interfaces:**
- Produces: `CoreNodesExtension`.

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, expect, it } from 'vitest'

import { supportsNodeType } from '../../capabilities/registered-node-types'
import { buildRestrictedEditor } from '../../test-support/build-test-editor'

describe('CoreNodesExtension', () => {
  it('keeps mark and overflow registered even in a fully stripped editor', () => {
    const editor = buildRestrictedEditor()
    expect(supportsNodeType(editor, 'mark')).toBe(true)
    expect(supportsNodeType(editor, 'overflow')).toBe(true)
    editor.dispose()
  })
})
```

- [ ] **Step 2: Run it to watch it fail**

Run: `cd packages/richtext-lexical && pnpm vitest run --mode=jsdom src/field/extensions/core-nodes/`
Expected: FAIL — cannot resolve the extension module.

- [ ] **Step 3: Implement it**

```ts
import { MarkNode } from '@lexical/mark'
import { OverflowNode } from '@lexical/overflow'
import { defineExtension } from 'lexical'

/**
 * Owns the node classes that belong to no switchable feature.
 *
 * `MarkNode` and `OverflowNode` ship with no upstream extension, and
 * neither corresponds to something a field can turn off, so this
 * extension is always present and deliberately absent from
 * `builtInExtensions` — there is no supported way to remove it.
 */
export const CoreNodesExtension = defineExtension({
  name: '@byline/richtext-lexical/CoreNodes',
  nodes: () => [MarkNode, OverflowNode],
})
```

Do **not** add it to `defaultExtensionsArray()` and do **not** add it to `builtInExtensions`. Neither would make it non-removable: this module is publicly exported and `ExtensionsList.remove()` matches by name while accepting the extension object itself, so site code could remove it from the configurable list either way.

Instead inject it at the editor root, outside `editorConfig.extensions`, in `editor-context.tsx`:

```ts
const dependencies = [CoreNodesExtension, ...configured.toArray()]
```

Mirror that injection in `test-support/build-test-editor.ts` so the shared builders reflect production rather than flattering it, and add a test that attempts the removal and asserts `MarkNode` and `OverflowNode` survive it.

- [ ] **Step 4: Run the test**

Run: `cd packages/richtext-lexical && pnpm vitest run --mode=jsdom src/field/extensions/core-nodes/`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/richtext-lexical/src/field/extensions/core-nodes/ packages/richtext-lexical/src/field/config/default-extensions.ts
git commit -s -m "feat(richtext): added an always-on core nodes extension"
```

---

### Task 5: Remove the blanket node array

This is the defect fix. Everything before it was preparation, and the two failing cases from Task 3 turn green here.

The harness tests from Tasks 3 and 4 cannot demonstrate this change: they build their own root extension, while the blanket array lives only in the shipped `EditorContext`. This task therefore adds a regression test that mounts the real component, and that test is the one that must go from red to green.

**Files:**
- Modify: `packages/richtext-lexical/src/field/editor-context.tsx:100`
- Modify: `packages/richtext-lexical/src/field/nodes/index.ts`
- Test: `packages/richtext-lexical/src/field/editor-context.regression.test.tsx`
- Test: `packages/richtext-lexical/src/field/capabilities/no-blanket-registration.test.tsx`

**Interfaces:**
- Produces: `READABLE_NODES` (renamed from `Nodes`), the vocabulary of node classes Byline can read, consumed by Task 16's manifest.

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, expect, it } from 'vitest'

import { buildFullEditor, buildRestrictedEditor, parseHtmlToTypes } from '../test-support/build-test-editor'
import { supportsNodeType } from './registered-node-types'

describe('node registration follows the extensions list', () => {
  it('registers nothing structural in a fully stripped editor', () => {
    const editor = buildRestrictedEditor()
    for (const type of ['heading', 'quote', 'table', 'link', 'list', 'code']) {
      expect(supportsNodeType(editor, type), `${type} must not be registered`).toBe(false)
    }
    editor.dispose()
  })

  it('degrades every structural paste and keeps the text', () => {
    const editor = buildRestrictedEditor()
    const cases: Array<[string, string, string]> = [
      ['<h1>Pasted title</h1>', 'paragraph', 'Pasted title'],
      ['<blockquote>Quoted words</blockquote>', 'paragraph', 'Quoted words'],
      ['<ul><li>one</li></ul>', 'paragraph', 'one'],
      ['<pre>const x = 1</pre>', 'paragraph', 'const x = 1'],
    ]
    for (const [html, type, text] of cases) {
      const result = parseHtmlToTypes(editor, html)
      expect(result.types, html).toEqual([type])
      expect(result.text, html).toContain(text)
    }
    editor.dispose()
  })

  it('does not regress the full default set', () => {
    const editor = buildFullEditor()
    expect(parseHtmlToTypes(editor, '<h1>Title</h1>').types).toEqual(['heading'])
    expect(parseHtmlToTypes(editor, '<ul><li>one</li></ul>').types).toEqual(['list'])
    expect(parseHtmlToTypes(editor, '<table><tr><td>cell</td></tr></table>').types).toEqual(['table'])
    expect(parseHtmlToTypes(editor, '<p>see <a href="https://x.com">link</a></p>').text).toContain('link')
    editor.dispose()
  })
})
```

- [ ] **Step 2: Write the production regression test**

This is the test that actually pins the defect, because it goes through `EditorContext` rather than a hand-built root extension.

```tsx
import { render, waitFor } from '@testing-library/react'
import type { LexicalEditor } from 'lexical'
import { describe, expect, it } from 'vitest'

import { builtInExtensions } from './config/built-in-extension-names'
import { defaultClientEditorConfig } from './config/default-extensions'
import { EditorContext } from './editor-context'
import { CaptureEditor } from './test-support/capture-editor'

/** Mounts the real EditorContext and hands back its editor. */
function mountEditor(removals: string[]) {
  const extensions = defaultClientEditorConfig.extensions!.clone()
  for (const name of removals) extensions.remove(name)
  let editor: LexicalEditor | undefined
  render(
    <EditorContext
      composerKey="regression"
      editorConfig={{ ...defaultClientEditorConfig, extensions }}
      onChange={() => {}}
      readOnly={false}
    >
      <CaptureEditor onEditor={(instance) => { editor = instance }} />
    </EditorContext>
  )
  return () => editor
}

describe('EditorContext registers only what its extensions own', () => {
  it('does not register headings when the heading extension is removed', async () => {
    const getEditor = mountEditor([builtInExtensions.Heading])
    await waitFor(() => expect(getEditor()).toBeDefined())
    expect(getEditor()!.hasNode(HeadingNode)).toBe(false)
  })

  it('still registers headings with the default configuration', async () => {
    const getEditor = mountEditor([])
    await waitFor(() => expect(getEditor()).toBeDefined())
    expect(getEditor()!.hasNode(HeadingNode)).toBe(true)
  })
})
```

Add `test-support/capture-editor.tsx` as part of this task — a one-line component calling `useLexicalComposerContext()` and handing the editor to its callback.

- [ ] **Step 3: Run both tests to watch them fail**

Run: `cd packages/richtext-lexical && pnpm vitest run --mode=jsdom src/field/editor-context.regression.test.tsx src/field/capabilities/no-blanket-registration.test.tsx`
Expected: the regression test's first case FAILS — `hasNode(HeadingNode)` is true because the blanket array registers it regardless. The harness test fails on its first two cases for the same underlying reason, once the harness no longer has the blanket array to mask it.

- [ ] **Step 4: Drop the blanket array from the root extension**

In `editor-context.tsx`, delete the `nodes: [...Nodes]` line from the `defineExtension` call and delete the now-unused `import { Nodes } from './nodes'`. Add a comment in its place:

```ts
    return defineExtension({
      name: '[root]',
      namespace: editorConfig.lexical.namespace,
      // No `nodes` here on purpose. Every node class is owned by the
      // extension that provides its feature, so removing an extension
      // removes its controls, its behaviour AND its node registration.
      // Re-adding a blanket list would let a field accept structures it
      // does not offer.
      theme: editorConfig.lexical.theme,
```

- [ ] **Step 5: Rename the array to say what it is now**

In `nodes/index.ts`, rename the export and rewrite its doc comment:

```ts
/**
 * Every node class Byline knows how to READ.
 *
 * This is not a registration list — registration belongs to the
 * extension that owns each node. It is the vocabulary the normalizer
 * and the capability manifest work from, so a stored document can be
 * inspected even when the field that opens it supports far less.
 */
export const READABLE_NODES: Array<Klass<LexicalNode>> = [
```

Update every import of `Nodes`. Verify none remain:

```bash
cd packages/richtext-lexical && grep -rn "\bNodes\b" src --include=*.ts --include=*.tsx | grep -v READABLE_NODES | grep -v registeredNodeTypes
```

Expected: no output.

- [ ] **Step 6: Run the tests**

Run: `cd packages/richtext-lexical && pnpm vitest run --mode=jsdom src/field/`
Expected: PASS, including both cases of the regression test. `editor-component.test.tsx` has one assertion that already fails on `develop`; it is unrelated and stays failing.

- [ ] **Step 7: Commit**

```bash
git add packages/richtext-lexical/src/field/
git commit -s -m "fix(richtext): made node registration follow the extensions list"
```

---

### Task 6: Make lists removable

`builtInExtensions` has no list or check-list entries, so downstream code cannot remove them without importing from `@lexical/list` and taking a direct dependency on a pinned `lexical`. Both were measured to degrade correctly once removable: bullet and check lists become one paragraph per item with text intact.

**Files:**
- Modify: `packages/richtext-lexical/src/field/config/built-in-extension-names.ts`
- Modify: `packages/richtext-lexical/src/field/config/built-in-extension-names.test.node.ts`
- Test: `packages/richtext-lexical/src/field/config/list-removal.test.tsx`

**Interfaces:**
- Produces: `builtInExtensions.List` = `'@lexical/list/List'`, `builtInExtensions.CheckList` = `'@lexical/list/CheckList'`.

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, expect, it } from 'vitest'

import { buildRestrictedEditor, parseHtmlToTypes } from '../test-support/build-test-editor'
import { builtInExtensions } from './built-in-extension-names'

describe('list removal', () => {
  it('degrades bullet and check lists to paragraphs', () => {
    const editor = buildRestrictedEditor([builtInExtensions.List, builtInExtensions.CheckList])
    const bullet = parseHtmlToTypes(editor, '<ul><li>item one</li><li>item two</li></ul>')
    expect(bullet.types).toEqual(['paragraph', 'paragraph'])
    expect(bullet.text).toContain('item one')
    expect(bullet.text).toContain('item two')
    editor.dispose()
  })
})
```

- [ ] **Step 2: Run it to watch it fail**

Run: `cd packages/richtext-lexical && pnpm vitest run --mode=jsdom src/field/config/list-removal.test.tsx`
Expected: FAIL — `builtInExtensions.List` is undefined, so nothing is removed.

- [ ] **Step 3: Add the entries and a documented exception group**

The existing entries all share the `@byline/richtext-lexical/*` convention, and `built-in-extension-names.test.node.ts` enforces that the suffix equals the map key. These two names are owned by `@lexical/list`, so split the map into two objects and merge them:

```ts
/**
 * Names owned by upstream Lexical packages.
 *
 * These deliberately break the `@byline/richtext-lexical/<Key>`
 * convention because Byline does not own the names — the extensions ship
 * from `@lexical/list`. They are listed here so downstream code can
 * remove lists without importing `@lexical/list` directly and taking a
 * version-pinned dependency on `lexical`.
 */
const upstreamExtensionNames = {
  List: '@lexical/list/List',
  CheckList: '@lexical/list/CheckList',
} as const

export const builtInExtensions = {
  ...bylineExtensionNames,
  ...upstreamExtensionNames,
} as const
```

Rename the existing object literal to `bylineExtensionNames` and leave its contents unchanged.

- [ ] **Step 4: Update the convention test**

The convention test must now assert the convention over `bylineExtensionNames` only, and assert separately that every upstream name is non-empty and unique across the merged map. Export `bylineExtensionNames` and `upstreamExtensionNames` for the test. Keep the uniqueness assertion over the merged `builtInExtensions`.

- [ ] **Step 5: Run both test modes**

Run: `cd packages/richtext-lexical && pnpm vitest run --mode=node src/field/config/built-in-extension-names.test.node.ts && pnpm vitest run --mode=jsdom src/field/config/list-removal.test.tsx`
Expected: PASS in both.

- [ ] **Step 6: Commit**

```bash
git add packages/richtext-lexical/src/field/config/
git commit -s -m "feat(richtext): exposed list and check-list names for removal"
```

---

### Task 7: Filter Markdown transformers by registered nodes

`BYLINE_TRANSFORMERS` is a second static list with the same defect shape, and it fails harder than registration does: `registerMarkdownShortcuts` throws `MarkdownShortcuts: missing dependency table for transformer` when a transformer's node class is absent. Removing the table extension currently breaks the entire Markdown pipeline rather than only tables.

Filtering `MarkdownShortcutPlugin` alone is not enough. Four sites feed the unfiltered list into Markdown **import**, and every one of them can create an unregistered node:

- `editor.tsx:170` — the shortcut plugin.
- `hooks/use-markdown-toggle.ts:121` — leaving Markdown source mode rebuilds the document from text via `$convertFromMarkdownString`.
- `hooks/use-markdown-toggle.ts:90` — entering source mode exports via `$convertToMarkdownString`; filter it too so the round trip is symmetric and source mode never offers syntax the field cannot import back.
- `markdown/transformers.ts:191` — the nested table-cell import.
- `markdown/transformers.ts:275` — the admonition body import, which uses `ADMONITION_BODY_TRANSFORMERS`. That list contains `LINK`, so it breaks when the link extension is removed.

**Files:**
- Create: `packages/richtext-lexical/src/field/capabilities/filter-transformers.ts`
- Modify: `packages/richtext-lexical/src/field/editor.tsx:169-171`
- Modify: `packages/richtext-lexical/src/field/hooks/use-markdown-toggle.ts:90,121`
- Modify: `packages/richtext-lexical/src/field/markdown/transformers.ts` — export `ADMONITION_BODY_TRANSFORMERS` so it can be filtered and tested
- Modify: `packages/richtext-lexical/src/field/markdown/transformers.ts:191,275`
- Test: `packages/richtext-lexical/src/field/capabilities/filter-transformers.test.tsx`

**Interfaces:**
- Consumes: `registeredNodeTypes` from Task 2.
- Produces: `transformersFor(editor: LexicalEditor, transformers: Array<Transformer>): Array<Transformer>`.

- [ ] **Step 1: Write the failing test**

```tsx
import { $convertFromMarkdownString, registerMarkdownShortcuts } from '@lexical/markdown'
import { $getRoot } from 'lexical'
import { describe, expect, it } from 'vitest'

import { ADMONITION_BODY_TRANSFORMERS, BYLINE_TRANSFORMERS } from '../markdown/transformers'
import { buildFullEditor, buildRestrictedEditor } from '../test-support/build-test-editor'
import { transformersFor } from './filter-transformers'

describe('transformersFor', () => {
  it('lets Markdown shortcuts register in a restricted editor', () => {
    const editor = buildRestrictedEditor()
    expect(() => {
      registerMarkdownShortcuts(editor, transformersFor(editor, BYLINE_TRANSFORMERS))
    }).not.toThrow()
    editor.dispose()
  })

  it('keeps every transformer when nothing is removed', () => {
    const editor = buildFullEditor()
    expect(transformersFor(editor, BYLINE_TRANSFORMERS)).toHaveLength(BYLINE_TRANSFORMERS.length)
    editor.dispose()
  })

  it('drops a transformer whose node is unregistered', () => {
    const editor = buildRestrictedEditor()
    expect(transformersFor(editor, BYLINE_TRANSFORMERS).length).toBeLessThan(BYLINE_TRANSFORMERS.length)
    editor.dispose()
  })

  it('survives a Markdown round trip through source mode in a restricted editor', () => {
    const editor = buildRestrictedEditor()
    const active = transformersFor(editor, BYLINE_TRANSFORMERS)
    expect(() => {
      editor.update(
        () => {
          $convertFromMarkdownString('# heading\n\n| a | b |\n| - | - |\n\ntext', active, undefined, true)
        },
        { discrete: true }
      )
    }).not.toThrow()
    let text = ''
    editor.read(() => {
      text = $getRoot().getTextContent()
    })
    expect(text).toContain('text')
    editor.dispose()
  })

  it('filters the admonition body list, which carries LINK', () => {
    const editor = buildRestrictedEditor()
    const active = transformersFor(editor, ADMONITION_BODY_TRANSFORMERS)
    expect(active.length).toBeLessThan(ADMONITION_BODY_TRANSFORMERS.length)
    editor.dispose()
  })
})
```

- [ ] **Step 2: Run it to watch it fail**

Run: `cd packages/richtext-lexical && pnpm vitest run --mode=jsdom src/field/capabilities/filter-transformers.test.tsx`
Expected: FAIL — module missing; and with the raw list the first case throws the missing-dependency error.

- [ ] **Step 3: Implement it**

A transformer declares the node classes it needs on its `dependencies` array. Keep a transformer only when every dependency is registered.

```ts
import type { Transformer } from '@lexical/markdown'
import type { LexicalEditor } from 'lexical'

import { registeredNodeTypes } from './registered-node-types'

/**
 * The transformers that can safely register on this editor.
 *
 * `registerMarkdownShortcuts` throws when a transformer names a node
 * class the editor has not registered, and it throws for the whole
 * pipeline rather than skipping that one transformer. Removing the table
 * extension would therefore disable Markdown entirely. Filtering here
 * keeps the shortcuts a field can actually support.
 */
export function transformersFor(
  editor: LexicalEditor,
  transformers: Array<Transformer>
): Array<Transformer> {
  const types = registeredNodeTypes(editor)
  return transformers.filter((transformer) => {
    const dependencies = 'dependencies' in transformer ? transformer.dependencies : undefined
    if (dependencies == null) return true
    return dependencies.every((klass) => types.has(klass.getType()))
  })
}
```

- [ ] **Step 4: Use it at all four sites**

`editor.tsx` renders `<MarkdownShortcutPlugin transformers={BYLINE_TRANSFORMERS} />`. Get the editor from `useLexicalComposerContext()` and pass the filtered list instead. Memoise on the editor:

```tsx
const [editor] = useLexicalComposerContext()
const activeTransformers = useMemo(() => transformersFor(editor, BYLINE_TRANSFORMERS), [editor])
```

`use-markdown-toggle.ts` already holds `editor`, so both call sites become `transformersFor(editor, BYLINE_TRANSFORMERS)`.

The two sites inside `transformers.ts` run within transformer closures, which have no `editor` parameter. Use `$getEditor()` from `lexical` to reach the active editor and filter there:

```ts
import { $getEditor } from 'lexical'

// transformers.ts:191 — nested table-cell import
$convertFromMarkdownString(content, transformersFor($getEditor(), BYLINE_TRANSFORMERS), cell)

// transformers.ts:275 — admonition body import
$convertFromMarkdownString(body, transformersFor($getEditor(), ADMONITION_BODY_TRANSFORMERS), node)
```

Importing `transformersFor` into `transformers.ts` introduces a cycle if `filter-transformers.ts` imports from `transformers.ts`. It must not — it takes the list as a parameter for exactly this reason. Verify:

```bash
cd packages/richtext-lexical && grep -n "import" src/field/capabilities/filter-transformers.ts
```

Expected: imports only `@lexical/markdown` types, `lexical` types, and `./registered-node-types`.

- [ ] **Step 5: Run the tests**

Run: `cd packages/richtext-lexical && pnpm vitest run --mode=jsdom src/field/capabilities/`
Expected: PASS, all cases.

- [ ] **Step 6: Commit**

```bash
git add packages/richtext-lexical/src/field/capabilities/filter-transformers.ts packages/richtext-lexical/src/field/capabilities/filter-transformers.test.tsx packages/richtext-lexical/src/field/editor.tsx
git commit -s -m "fix(richtext): filtered markdown transformers by registered nodes"
```

---

### Task 8: Derive toolbar controls from capabilities

A control for a disabled structure is a crash, not a cosmetic inconsistency: creating an unregistered node throws `Attempted to create node HeadingNode that was not configured to be used on the editor`. The block-format dropdown hard-codes h1 to h4, bullet, numbered, check, quote and code behind the single `textStyle` flag, so each entry is a live crash once its extension is removable.

Gate structural availability on **registered node types**, never on list membership: table and list nodes arrive through `@lexical/table` and `@lexical/list` dependencies, so a membership test would be wrong for exactly those cases.

Registered nodes are necessary but not always sufficient. A control that needs behaviour as well as a node must check both. The check-list format is the case in point: `ListNode` and `ListItemNode` come from `ListExtension`, so removing only `CheckListExtension` leaves both nodes registered while the check-list behaviour is gone — a node-only rule would keep offering a control that no longer works. So: **registered nodes decide structural availability; a control that needs extra behaviour additionally checks for the resolved behaviour extension.**

`useOptionalExtensionDependency` is the right tool for that second check, and the existing `hasTableExtension` call in `editor.tsx` is a correct use of it for the wrong question — table availability is structural and moves to a node check, while check-list keeps the hook.

**Files:**
- Modify: `packages/richtext-lexical/src/field/plugins/toolbar-plugin/index.tsx:240-330`
- Modify: `packages/richtext-lexical/src/field/editor.tsx:134` (replace `hasTableExtension`)
- Test: `packages/richtext-lexical/src/field/plugins/toolbar-plugin/block-format-capabilities.test.tsx`

**Interfaces:**
- Consumes: `supportsNodeType` from Task 2.

- [ ] **Step 1: Write the failing test**

Test the predicate that drives the dropdown rather than rendering the toolbar, so the assertion is about capability rather than markup.

```tsx
import { describe, expect, it } from 'vitest'

import { buildFullEditor, buildRestrictedEditor } from '../../test-support/build-test-editor'
import { availableBlockFormats } from './index'

describe('availableBlockFormats', () => {
  it('offers every format when the full set is present', () => {
    const editor = buildFullEditor()
    const formats = availableBlockFormats(editor, true)
    expect(formats).toContain('h1')
    expect(formats).toContain('quote')
    expect(formats).toContain('bullet')
    editor.dispose()
  })

  it('offers only paragraph when everything structural is removed', () => {
    const editor = buildRestrictedEditor()
    expect(availableBlockFormats(editor, false)).toEqual(['paragraph'])
    editor.dispose()
  })

  it('never offers a format whose node is unregistered', () => {
    const editor = buildRestrictedEditor()
    for (const format of availableBlockFormats(editor, false)) {
      expect(format).toBe('paragraph')
    }
    editor.dispose()
  })

  it('offers bullets but not check lists when only CheckListExtension is removed', () => {
    const editor = buildRestrictedEditor([builtInExtensions.CheckList])
    const formats = availableBlockFormats(editor, false)
    expect(formats).toContain('bullet')
    expect(formats).not.toContain('check')
    editor.dispose()
  })
})
```

- [ ] **Step 2: Run it to watch it fail**

Run: `cd packages/richtext-lexical && pnpm vitest run --mode=jsdom src/field/plugins/toolbar-plugin/`
Expected: FAIL — `availableBlockFormats` is not exported.

- [ ] **Step 3: Implement the predicate and gate the entries**

Export from `toolbar-plugin/index.tsx`:

```tsx
export type BlockFormat = 'paragraph' | 'h1' | 'h2' | 'h3' | 'h4' | 'bullet' | 'number' | 'check' | 'quote' | 'code'

/**
 * Block formats this editor can actually produce. Paragraph is always
 * available.
 *
 * `hasCheckListBehaviour` is passed in rather than derived from nodes:
 * check lists need `CheckListExtension` registered as well as the list
 * nodes, and removing that extension alone leaves the nodes in place.
 */
export function availableBlockFormats(
  editor: LexicalEditor,
  hasCheckListBehaviour: boolean
): BlockFormat[] {
  const formats: BlockFormat[] = ['paragraph']
  if (supportsNodeType(editor, 'heading')) formats.push('h1', 'h2', 'h3', 'h4')
  if (supportsNodeType(editor, 'list') && supportsNodeType(editor, 'listitem')) {
    formats.push('bullet', 'number')
    if (hasCheckListBehaviour) formats.push('check')
  }
  if (supportsNodeType(editor, 'quote')) formats.push('quote')
  if (supportsNodeType(editor, 'code')) formats.push('code')
  return formats
}
```

At the call site in the dropdown:

```tsx
const hasCheckList = useOptionalExtensionDependency(CheckListExtension) !== undefined
const formats = availableBlockFormats(editor, hasCheckList)
```

In the dropdown body, compute `const formats = availableBlockFormats(editor)` and wrap each `DropDownItem` in a membership check, for example `{formats.includes('h1') && (<DropDownItem …>)}`. Hide the whole dropdown when `formats.length === 1`, since paragraph alone offers no choice.

In `editor.tsx`, replace `useOptionalExtensionDependency(BylineTableExtension) !== undefined` with `supportsNodeType(editor, 'table')`, and delete the now-unused import.

- [ ] **Step 4: Run the tests**

Run: `cd packages/richtext-lexical && pnpm vitest run --mode=jsdom src/field/plugins/toolbar-plugin/`
Expected: PASS, three cases.

- [ ] **Step 5: Commit**

```bash
git add packages/richtext-lexical/src/field/plugins/toolbar-plugin/ packages/richtext-lexical/src/field/editor.tsx
git commit -s -m "fix(richtext): derived block format controls from registered nodes"
```

---

### Task 9: Split capabilities from interface preferences

`textStyle: false` reads as "headings are disabled" but only hides a dropdown. The configuration model is reshaped so that what a field supports lives in the extensions list and what its interface shows lives under `controls`. This is a clean break with no alias.

**Files:**
- Modify: `packages/richtext-lexical/src/field/config/types.ts`
- Modify: `packages/richtext-lexical/src/field/config/default.ts`
- Modify: `packages/richtext-lexical/src/field/config/resolve-editor-config.ts`
- Modify: `packages/richtext-lexical/src/field/editor.tsx`, `plugins/toolbar-plugin/index.tsx`
- Test: `packages/richtext-lexical/src/field/config/resolve-editor-config.test.node.ts`

**Interfaces:**
- Produces: the `EditorSettings` shape below. `options` no longer exists.

- [ ] **Step 1: Write the failing test**

Add to `resolve-editor-config.test.node.ts`:

```ts
it('resolves the control and mode settings', () => {
  const config = resolveEditorConfig({ settings: { controls: { blockFormat: false } } })
  expect(config.settings.controls.blockFormat).toBe(false)
  expect(config.settings.controls.undoRedo).toBe(true)
  expect(config.settings.mode).toBe('richText')
  expect(config.settings.markdownShortcuts).toBe(false)
  expect('options' in config.settings).toBe(false)
})
```

- [ ] **Step 2: Run it to watch it fail**

Run: `cd packages/richtext-lexical && pnpm vitest run --mode=node src/field/config/resolve-editor-config.test.node.ts`
Expected: FAIL — `controls` does not exist.

- [ ] **Step 3: Reshape the types**

```ts
/**
 * Interface preferences. Every flag here hides an affordance and nothing
 * else — none of them restricts what the field accepts. What a field
 * supports is decided by its extensions list, not by this record.
 */
export interface EditorControls {
  /** Show the block-format dropdown. Entries are further limited to formats the editor can produce. */
  blockFormat: boolean
  /**
   * Show the inline-code button. This does NOT prevent inline code: it is
   * a `TextNode` format rather than a node type, so it still arrives by
   * paste. Node-level configuration cannot constrain it.
   */
  inlineCode: boolean
  /** Show the undo and redo buttons. Keyboard undo keeps working either way. */
  undoRedo: boolean
  textAlignment: boolean
  markdownToggle: boolean
  treeView: boolean
}

export interface EditorSettings {
  mode: 'richText' | 'plainText'
  markdownShortcuts: boolean
  controls: EditorControls
  inlineImageUploadCollection: string
  placeholderText: string
  debug: boolean
}

export interface EditorSettingsOverride {
  mode?: EditorSettings['mode']
  markdownShortcuts?: boolean
  controls?: Partial<EditorControls>
  inlineImageUploadCollection?: string
  placeholderText?: string
  debug?: boolean
}
```

- [ ] **Step 4: Update the defaults and the resolver**

`DEFAULT_EDITOR_SETTINGS` becomes `mode: 'richText'`, `markdownShortcuts: false`, `debug: false`, and `controls` with `blockFormat`, `inlineCode`, `undoRedo`, `textAlignment` true and `markdownToggle`, `treeView` false. `resolveEditorConfig` must deep-merge `controls` rather than replacing it, so a partial override keeps the untouched defaults.

- [ ] **Step 5: Update every consumer**

`editor.tsx` reads `mode === 'richText'` in place of `richText`, `markdownShortcuts` in place of `markdownShortcutPlugin`, and `controls.treeView` in place of `showTreeView`. `toolbar-plugin/index.tsx` reads `controls.textAlignment`, `controls.undoRedo`, `controls.blockFormat`, `controls.inlineCode`, `controls.markdownToggle`. Confirm nothing is missed:

```bash
cd packages/richtext-lexical && grep -rn "options\.\|textStyle\|markdownShortcutPlugin\|showTreeView" src --include=*.ts --include=*.tsx | grep -v "\.test\."
```

Expected: no output.

- [ ] **Step 6: Run the full package suite**

Run: `cd packages/richtext-lexical && pnpm vitest run --mode=node && pnpm vitest run --mode=jsdom && pnpm typecheck`
Expected: PASS apart from the pre-existing `editor-component.test.tsx` assertion.

- [ ] **Step 7: Commit**

```bash
git add packages/richtext-lexical/src/
git commit -s -m "feat(richtext)!: split editor capabilities from interface preferences"
```

---

### Task 10: The declared conversion table

Conversions are explicit data, one entry per structure Byline knows how to convert. Anything absent from this table — a custom node from a downstream site, an inline image, an embed — is never guessed at.

**Files:**
- Create: `packages/richtext-lexical/src/field/normalize/declared-conversions.ts`
- Test: `packages/richtext-lexical/src/field/normalize/declared-conversions.test.node.ts`

**Interfaces:**
- Produces:

```ts
export type SerializedNode = { type: string; children?: SerializedNode[]; [key: string]: unknown }
export type ConversionKind = 'to-paragraph' | 'lift-blocks' | 'unwrap-inline' | 'drop'
export interface DeclaredConversion {
  kind: ConversionKind
  /** Text pulled out of the node's own properties and preserved ahead of its children. */
  preserveText?: (node: SerializedNode) => string | undefined
}
export const DECLARED_CONVERSIONS: Readonly<Record<string, DeclaredConversion>>
export function conversionFor(type: string): DeclaredConversion | undefined
```

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest'

import { conversionFor, DECLARED_CONVERSIONS } from './declared-conversions'

describe('declared conversions', () => {
  it('declares one for every structure the spec lists as supported', () => {
    for (const type of [
      'heading', 'quote', 'code', 'table', 'tablerow', 'tablecell',
      'list', 'listitem', 'layout-container', 'layout-item', 'admonition',
      'horizontalrule', 'link', 'autolink',
    ]) {
      expect(conversionFor(type), type).toBeDefined()
    }
  })

  it('declares none for media, embeds or unknown types', () => {
    for (const type of ['inline-image', 'youtube', 'vimeo', 'some-custom-node']) {
      expect(conversionFor(type), type).toBeUndefined()
    }
  })

  it('preserves the admonition title as text', () => {
    const conversion = DECLARED_CONVERSIONS.admonition
    expect(conversion.preserveText?.({ type: 'admonition', title: 'Note title' })).toBe('Note title')
  })

  it('preserves the link URL as text', () => {
    const conversion = DECLARED_CONVERSIONS.link
    expect(conversion.preserveText?.({ type: 'link', url: 'https://example.com' })).toBe('https://example.com')
  })

  it('drops a horizontal rule without inventing text', () => {
    expect(DECLARED_CONVERSIONS.horizontalrule.kind).toBe('drop')
    expect(DECLARED_CONVERSIONS.horizontalrule.preserveText).toBeUndefined()
  })

  it('classifies each structure by what it contains', () => {
    expect(DECLARED_CONVERSIONS.heading.kind).toBe('to-paragraph')
    expect(DECLARED_CONVERSIONS.listitem.kind).toBe('to-paragraph')
    expect(DECLARED_CONVERSIONS.table.kind).toBe('lift-blocks')
    expect(DECLARED_CONVERSIONS.list.kind).toBe('lift-blocks')
    expect(DECLARED_CONVERSIONS.link.kind).toBe('unwrap-inline')
  })
})
```

- [ ] **Step 2: Run it to watch it fail**

Run: `cd packages/richtext-lexical && pnpm vitest run --mode=node src/field/normalize/declared-conversions.test.node.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement the table**

Verify each node type string against its class before writing it down — read `static getType()` in each node source rather than guessing, since `layout-container` and `inline-image` are easy to get wrong.

```ts
/**
 * How each convertible structure degrades when a field does not support it.
 *
 * The kind records what the node CONTAINS, which is what decides a
 * structurally valid replacement:
 *
 * - `to-paragraph` — a block holding inline content. Becomes exactly one
 *   paragraph, so two adjacent headings stay two paragraphs and an empty
 *   heading stays an empty paragraph instead of vanishing.
 * - `lift-blocks` — a block holding blocks. Its children are lifted in
 *   place, already block-level and already valid where the parent sat.
 * - `unwrap-inline` — inline content. Its children are lifted inline and
 *   stay inside the paragraph that held them.
 * - `drop` — removed entirely; neighbours are untouched.
 *
 * `preserveText` follows the kind: `lift-blocks` emits it as a leading
 * paragraph (the admonition title becomes the first line), while
 * `unwrap-inline` appends it to the text (the link URL follows its
 * text).
 *
 * A type absent from this table has NO conversion and is never guessed
 * at — normalization refuses the document instead. That covers custom
 * nodes from downstream sites as well as inline images and embeds, whose
 * media relations and nested-editor captions cannot survive any
 * structural rewrite.
 */
const urlText = (node: SerializedNode) =>
  typeof node.url === 'string' && node.url.length > 0 ? node.url : undefined

export const DECLARED_CONVERSIONS = {
  // Blocks holding inline content.
  heading: { kind: 'to-paragraph' },
  quote: { kind: 'to-paragraph' },
  code: { kind: 'to-paragraph' },
  listitem: { kind: 'to-paragraph' },

  // Blocks holding blocks.
  table: { kind: 'lift-blocks' },
  tablerow: { kind: 'lift-blocks' },
  tablecell: { kind: 'lift-blocks' },
  list: { kind: 'lift-blocks' },
  'layout-container': { kind: 'lift-blocks' },
  'layout-item': { kind: 'lift-blocks' },
  admonition: {
    kind: 'lift-blocks',
    preserveText: (node) =>
      typeof node.title === 'string' && node.title.length > 0 ? node.title : undefined,
  },

  // Inline content.
  link: { kind: 'unwrap-inline', preserveText: urlText },
  autolink: { kind: 'unwrap-inline', preserveText: urlText },

  horizontalrule: { kind: 'drop' },
} as const satisfies Record<string, DeclaredConversion>

export function conversionFor(type: string): DeclaredConversion | undefined {
  return (DECLARED_CONVERSIONS as Record<string, DeclaredConversion | undefined>)[type]
}
```

- [ ] **Step 4: Run the tests**

Run: `cd packages/richtext-lexical && pnpm vitest run --mode=node src/field/normalize/declared-conversions.test.node.ts`
Expected: PASS, five cases.

- [ ] **Step 5: Commit**

```bash
git add packages/richtext-lexical/src/field/normalize/
git commit -s -m "feat(richtext): declared the conversion table for unsupported structures"
```

---

### Task 11: The immutable tree rewrite

This is the heart of the compatibility work, and the place the earlier whole-document HTML round-trip design failed review: it damaged supported content as collateral. The rewrite must copy a supported node's own properties while still inspecting its children, because a supported parent may contain an unsupported descendant.

**Files:**
- Create: `packages/richtext-lexical/src/field/normalize/normalize-value.ts`
- Test: `packages/richtext-lexical/src/field/normalize/normalize-value.test.node.ts`

**Interfaces:**
- Consumes: `conversionFor`, `SerializedNode` from Task 10.
- Produces:

```ts
export type NormalizeResult =
  | { status: 'unchanged' }
  | { status: 'adapted'; value: SerializedEditorState; convertedTypes: string[] }
  | { status: 'refused'; unsupportedTypes: string[] }

export function normalizeValue(
  value: SerializedEditorState,
  supportedTypes: ReadonlySet<string>
): NormalizeResult
```

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from 'vitest'

import { normalizeValue } from './normalize-value'

const text = (value: string, format = 0) => ({
  detail: 0, format, mode: 'normal', style: '', text: value, type: 'text', version: 1,
})
const para = (...children: any[]) => ({
  children, direction: null, format: '', indent: 0, type: 'paragraph', version: 1,
})
const doc = (...children: any[]) => ({
  root: { children, direction: null, format: '', indent: 0, type: 'root', version: 1 },
}) as any
const SUPPORTED = new Set(['root', 'paragraph', 'text', 'linebreak', 'tab'])

describe('normalizeValue', () => {
  it('reports unchanged when every type is supported', () => {
    expect(normalizeValue(doc(para(text('hi'))), SUPPORTED).status).toBe('unchanged')
  })

  it('never mutates its input', () => {
    const input = doc({ children: [text('Title')], direction: null, format: '', indent: 0, type: 'heading', version: 1, tag: 'h1' })
    const snapshot = JSON.stringify(input)
    normalizeValue(input, SUPPORTED)
    expect(JSON.stringify(input)).toBe(snapshot)
  })

  it('converts a heading to a paragraph and preserves inline formats exactly', () => {
    const result = normalizeValue(
      doc({ children: [text('Bold title', 1)], direction: null, format: '', indent: 0, type: 'heading', version: 1, tag: 'h1' }),
      SUPPORTED
    )
    expect(result.status).toBe('adapted')
    if (result.status !== 'adapted') return
    const first = result.value.root.children[0] as any
    expect(first.type).toBe('paragraph')
    expect(first.tag).toBeUndefined()
    expect(first.children[0].format).toBe(1)
    expect(result.convertedTypes).toEqual(['heading'])
  })

  it('keeps a supported sibling byte-for-byte identical', () => {
    const survivor = para(text('body'))
    const result = normalizeValue(
      doc({ children: [text('T')], direction: null, format: '', indent: 0, type: 'heading', version: 1, tag: 'h1' }, survivor),
      SUPPORTED
    )
    if (result.status !== 'adapted') throw new Error('expected adapted')
    expect(result.value.root.children[1]).toEqual(survivor)
  })

  it('inspects children of a supported parent', () => {
    const supported = new Set([...SUPPORTED, 'quote'])
    const result = normalizeValue(
      doc({ children: [{ children: [text('inner')], direction: null, format: '', indent: 0, type: 'heading', version: 1, tag: 'h2' }],
            direction: null, format: '', indent: 0, type: 'quote', version: 1 }),
      supported
    )
    if (result.status !== 'adapted') throw new Error('expected adapted')
    const quote = result.value.root.children[0] as any
    expect(quote.type).toBe('quote')
    expect(quote.children[0].type).toBe('paragraph')
  })

  it('flattens a nested table to one paragraph per cell', () => {
    const cell = { children: [para(text('cell text'))], direction: null, format: '', indent: 0, type: 'tablecell', version: 1, colSpan: 1, rowSpan: 1, headerState: 0 }
    const row = { children: [cell], direction: null, format: '', indent: 0, type: 'tablerow', version: 1 }
    const result = normalizeValue(doc({ children: [row], direction: null, format: '', indent: 0, type: 'table', version: 1 }), SUPPORTED)
    if (result.status !== 'adapted') throw new Error('expected adapted')
    expect(result.value.root.children.map((c: any) => c.type)).toEqual(['paragraph'])
    expect((result.value.root.children[0] as any).children[0].text).toBe('cell text')
  })

  it('wraps lifted inline children in a paragraph', () => {
    const result = normalizeValue(
      doc(para({ children: [text('link text')], direction: null, format: '', indent: 0, type: 'link', version: 1, url: 'https://x.com' })),
      SUPPORTED
    )
    if (result.status !== 'adapted') throw new Error('expected adapted')
    const p = result.value.root.children[0] as any
    expect(p.type).toBe('paragraph')
    expect(p.children.map((c: any) => c.text).join('')).toContain('link text')
    expect(p.children.map((c: any) => c.text).join('')).toContain('https://x.com')
  })

  it('drops a horizontal rule and keeps its neighbours', () => {
    const result = normalizeValue(
      doc(para(text('before')), { type: 'horizontalrule', version: 1 }, para(text('after'))),
      SUPPORTED
    )
    if (result.status !== 'adapted') throw new Error('expected adapted')
    expect(result.value.root.children.map((c: any) => c.type)).toEqual(['paragraph', 'paragraph'])
  })

  it('keeps adjacent headings as separate paragraphs', () => {
    const result = normalizeValue(
      doc(
        { children: [text('First')], direction: null, format: '', indent: 0, type: 'heading', version: 1, tag: 'h1' },
        { children: [text('Second')], direction: null, format: '', indent: 0, type: 'heading', version: 1, tag: 'h2' }
      ),
      SUPPORTED
    )
    if (result.status !== 'adapted') throw new Error('expected adapted')
    const kids = result.value.root.children as any[]
    expect(kids).toHaveLength(2)
    expect(kids[0].children[0].text).toBe('First')
    expect(kids[1].children[0].text).toBe('Second')
  })

  it('keeps an empty heading as an empty paragraph', () => {
    const result = normalizeValue(
      doc({ children: [], direction: null, format: '', indent: 0, type: 'heading', version: 1, tag: 'h1' }, para(text('after'))),
      SUPPORTED
    )
    if (result.status !== 'adapted') throw new Error('expected adapted')
    const kids = result.value.root.children as any[]
    expect(kids).toHaveLength(2)
    expect(kids[0].type).toBe('paragraph')
    expect(kids[0].children).toEqual([])
  })

  it('keeps a supported link inside its paragraph rather than at root', () => {
    const link = { children: [text('link text')], direction: null, format: '', indent: 0, type: 'link', version: 1, url: 'https://x.com' }
    const result = normalizeValue(
      doc({ children: [link], direction: null, format: '', indent: 0, type: 'heading', version: 1, tag: 'h1' }),
      new Set([...SUPPORTED, 'link'])
    )
    if (result.status !== 'adapted') throw new Error('expected adapted')
    const kids = result.value.root.children as any[]
    expect(kids[0].type).toBe('paragraph')
    expect(kids[0].children[0].type).toBe('link')
  })

  it('emits the admonition title as the first line, not appended', () => {
    const result = normalizeValue(
      doc({ children: [para(text('body copy'))], direction: null, format: '', indent: 0, type: 'admonition', version: 1, title: 'Note title' }),
      SUPPORTED
    )
    if (result.status !== 'adapted') throw new Error('expected adapted')
    const kids = result.value.root.children as any[]
    expect(kids[0].children[0].text).toBe('Note title')
    expect(kids[1].children[0].text).toBe('body copy')
  })

  it('produces a tree Lexical can actually load', () => {
    // Mixed content: adjacent headings, an empty heading, a table and a list.
    const result = normalizeValue(
      doc(
        { children: [text('One')], direction: null, format: '', indent: 0, type: 'heading', version: 1, tag: 'h1' },
        { children: [], direction: null, format: '', indent: 0, type: 'heading', version: 1, tag: 'h2' },
        { children: [text('Two')], direction: null, format: '', indent: 0, type: 'heading', version: 1, tag: 'h2' }
      ),
      SUPPORTED
    )
    if (result.status !== 'adapted') throw new Error('expected adapted')
    // Structural assertion only here; `wiring.test.tsx` loads it into a real editor.
    for (const child of result.value.root.children as any[]) {
      expect(child.type).toBe('paragraph')
    }
  })

  it('refuses a document containing an undeclared type', () => {
    const result = normalizeValue(doc(para({ type: 'inline-image', version: 1, src: '/x.png' })), SUPPORTED)
    expect(result.status).toBe('refused')
    if (result.status !== 'refused') return
    expect(result.unsupportedTypes).toContain('inline-image')
  })

  it('refuses for an unknown custom node rather than unwrapping it', () => {
    const result = normalizeValue(
      doc({ children: [para(text('inner'))], type: 'acme-callout', version: 1 }),
      SUPPORTED
    )
    expect(result.status).toBe('refused')
  })

  it('does not refuse when the custom node is supported', () => {
    const result = normalizeValue(
      doc({ children: [para(text('inner'))], type: 'acme-callout', version: 1 }),
      new Set([...SUPPORTED, 'acme-callout'])
    )
    expect(result.status).toBe('unchanged')
  })

  it('preserves a supported image nested inside an unsupported container', () => {
    const image = { type: 'inline-image', version: 1, src: '/cat.png', altText: 'a cat' }
    const result = normalizeValue(
      doc({ children: [{ children: [para(image)], direction: null, format: '', indent: 0, type: 'layout-item', version: 1 }],
            direction: null, format: '', indent: 0, type: 'layout-container', version: 1, templateColumns: '1fr' }),
      new Set([...SUPPORTED, 'inline-image'])
    )
    if (result.status !== 'adapted') throw new Error('expected adapted')
    expect(JSON.stringify(result.value)).toContain('/cat.png')
    expect(JSON.stringify(result.value)).toContain('a cat')
  })
})
```

- [ ] **Step 2: Run them to watch them fail**

Run: `cd packages/richtext-lexical && pnpm vitest run --mode=node src/field/normalize/normalize-value.test.node.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement the rewrite**

Walk depth-first, building new objects throughout. Refusal wins over any conversion, so the whole tree is walked before deciding.

The kind decides the replacement, which is what keeps structure valid. An earlier draft of this plan lifted every unsupported block's children as loose inline nodes and regrouped them afterwards; that merged two adjacent headings into one paragraph reading "FirstSecond", erased empty headings, and could place a supported link directly under root. Converting each block into its own block removes that whole class of bug.

```ts
import type { SerializedEditorState } from 'lexical'

import { conversionFor, type SerializedNode } from './declared-conversions'

const textNode = (text: string): SerializedNode => ({
  detail: 0, format: 0, mode: 'normal', style: '', text, type: 'text', version: 1,
})

const paragraphNode = (children: SerializedNode[]): SerializedNode => ({
  children, direction: null, format: '', indent: 0, type: 'paragraph', version: 1,
})

export function normalizeValue(
  value: SerializedEditorState,
  supportedTypes: ReadonlySet<string>
): NormalizeResult {
  const converted = new Set<string>()
  const refused = new Set<string>()

  function visit(node: SerializedNode): SerializedNode[] {
    const children = Array.isArray(node.children) ? (node.children as SerializedNode[]) : undefined

    // Supported: keep this node's OWN properties, but still inspect its
    // children — a supported parent may hold an unsupported descendant.
    // A supported node was already in a valid position in the saved
    // document, so its position is never changed here.
    if (node.type === 'root' || supportedTypes.has(node.type)) {
      return children == null ? [node] : [{ ...node, children: children.flatMap(visit) }]
    }

    // Unsupported with no declared conversion: never guessed at.
    const conversion = conversionFor(node.type)
    if (conversion == null) {
      refused.add(node.type)
      return [node]
    }

    converted.add(node.type)
    const preserved = conversion.preserveText?.(node)
    const inner = (children ?? []).flatMap(visit)

    switch (conversion.kind) {
      case 'drop':
        return []

      // A block of inline content becomes exactly ONE paragraph, so
      // adjacent blocks stay separate and an empty one stays an empty line.
      case 'to-paragraph':
        return [paragraphNode(preserved != null ? [...inner, textNode(` ${preserved}`)] : inner)]

      // A block of blocks lifts its children, which are already blocks.
      // Preserved text leads as its own paragraph — the admonition title
      // becomes the first line, as the spec requires.
      case 'lift-blocks':
        return preserved != null ? [paragraphNode([textNode(preserved)]), ...inner] : inner

      // Inline content stays inline, inside the paragraph that held it.
      case 'unwrap-inline':
        return preserved != null ? [...inner, textNode(` ${preserved}`)] : inner
    }
  }

  const nextRoot = visit(value.root as unknown as SerializedNode)[0]

  if (refused.size > 0) return { status: 'refused', unsupportedTypes: [...refused] }
  if (converted.size === 0) return { status: 'unchanged' }
  return {
    status: 'adapted',
    value: { ...value, root: nextRoot } as SerializedEditorState,
    convertedTypes: [...converted],
  }
}
```

Two details the tests pin. `visit` returns a **list**, because a conversion can yield several nodes or none, and the caller flattens. And `unchanged` is returned only when nothing was converted or dropped, so the caller can skip the notice and leave the form's value untouched entirely.

- [ ] **Step 4: Run the tests**

Run: `cd packages/richtext-lexical && pnpm vitest run --mode=node src/field/normalize/normalize-value.test.node.ts`
Expected: PASS, all thirteen cases.

- [ ] **Step 5: Commit**

```bash
git add packages/richtext-lexical/src/field/normalize/
git commit -s -m "feat(richtext): added an immutable normalizer for unsupported structures"
```

---

### Task 12: Wire normalization into the editor

Two entry points carry a value into the editor: `editor-context.tsx:103` builds `$initialEditorState` when the root extension is constructed, and `apply-value-plugin.tsx:62` parses incoming values afterwards. Both must normalize, or a document that opens cleanly will still throw when the form re-applies its value.

`$initialEditorState` cannot be fixed by a mount effect. It is evaluated while the editor is being built, so an unnormalized value throws inside `buildEditorFromExtensions` before any effect can run — and the normalizer needs the registered type set, which does not exist until that build completes. The circularity is resolved by removing the initializer: the root extension is built with **no** initial state, and the value reaches the editor only through the normalizing apply path, which by then can read the real registered types.

**Files:**
- Modify: `packages/richtext-lexical/src/field/editor-context.tsx`
- Modify: `packages/richtext-lexical/src/field/apply-value-plugin.tsx`
- Create: `packages/richtext-lexical/src/field/normalize/adapted-notice.tsx`
- Test: `packages/richtext-lexical/src/field/normalize/wiring.test.tsx`

**Interfaces:**
- Consumes: `normalizeValue` (Task 11), `registeredNodeTypes` (Task 2).
- Produces: `AdaptedNotice`, `UnsupportedContentNotice`.

- [ ] **Step 1: Write the failing test**

Mount the real component with unsupported initial content, then apply a replacement value. Testing `normalizeValue` directly here would prove nothing about the wiring, which is where the initializer bug lives.

```tsx
import { render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { builtInExtensions } from '../config/built-in-extension-names'
import { defaultClientEditorConfig } from '../config/default-extensions'
import { EditorContext } from '../editor-context'
import { CaptureEditor } from '../test-support/capture-editor'

const savedHeading = (text: string) => ({
  root: { children: [
    { children: [{ detail: 0, format: 0, mode: 'normal', style: '', text, type: 'text', version: 1 }],
      direction: null, format: '', indent: 0, type: 'heading', version: 1, tag: 'h1' },
  ], direction: null, format: '', indent: 0, type: 'root', version: 1 },
})

function mountWithoutHeadings(value: any) {
  const extensions = defaultClientEditorConfig.extensions!.clone()
  extensions.remove(builtInExtensions.Heading)
  let editor: any
  const view = render(
    <EditorContext
      composerKey="wiring"
      editorConfig={{ ...defaultClientEditorConfig, extensions }}
      onChange={() => {}}
      readOnly={false}
      value={value}
    >
      <CaptureEditor onEditor={(instance) => { editor = instance }} />
    </EditorContext>
  )
  return { view, getEditor: () => editor }
}

describe('normalization wiring', () => {
  it('mounts with unsupported initial content without throwing', async () => {
    const { getEditor } = mountWithoutHeadings(savedHeading('Legacy title'))
    await waitFor(() => expect(getEditor()).toBeDefined())
    let text = ''
    getEditor().read(() => { text = $getRoot().getTextContent() })
    expect(text).toBe('Legacy title')
    expect($getRoot).toBeDefined()
  })

  it('shows the adapted notice', async () => {
    mountWithoutHeadings(savedHeading('Legacy title'))
    await waitFor(() =>
      expect(screen.getByText(/no longer supports/i)).toBeInTheDocument()
    )
  })

  it('normalizes a replacement value applied after mount', async () => {
    const { view, getEditor } = mountWithoutHeadings(undefined)
    await waitFor(() => expect(getEditor()).toBeDefined())
    view.rerender(/* same tree with value={savedHeading('Applied later')} */ <div />)
    await waitFor(() => {
      let text = ''
      getEditor().read(() => { text = $getRoot().getTextContent() })
      expect(text).toBe('Applied later')
    })
  })

  it('opens read-only and names the content when there is no conversion', async () => {
    const image = { root: { children: [
      { children: [{ type: 'inline-image', version: 1, src: '/cat.png' }],
        direction: null, format: '', indent: 0, type: 'paragraph', version: 1 },
    ], direction: null, format: '', indent: 0, type: 'root', version: 1 } }
    const extensions = defaultClientEditorConfig.extensions!.clone()
    extensions.remove(builtInExtensions.InlineImage)
    render(
      <EditorContext composerKey="refused" editorConfig={{ ...defaultClientEditorConfig, extensions }}
        onChange={() => {}} readOnly={false} value={image as any} />
    )
    await waitFor(() => expect(screen.getByText(/read-only/i)).toBeInTheDocument())
  })
})
```

Fill in the third case's `rerender` with the same element tree carrying the new `value` prop; it is written as a comment only to keep the example short.

- [ ] **Step 2: Run it to watch it fail**

Run: `cd packages/richtext-lexical && pnpm vitest run --mode=jsdom src/field/normalize/wiring.test.tsx`
Expected: FAIL. The first case throws `parseEditorState: type "heading" + not found` from inside the editor build, which is exactly the initializer problem this task removes.

- [ ] **Step 3: Remove the initializer so no unnormalized JSON can reach it**

In `editor-context.tsx`, delete the `$initialEditorState` line from `defineExtension` and leave a comment recording why:

```ts
      // No `$initialEditorState`. It is evaluated while the editor is
      // being built, before the registered node types exist, so an
      // unnormalized value would throw inside the builder with no chance
      // to adapt it. The value arrives through ApplyValuePlugin instead,
      // which normalizes against the built editor's real capabilities.
```

The `useMemo` that builds the root extension no longer reads `value`; leave the capture-once comment above it intact, since it still explains why the memo has empty dependencies.

- [ ] **Step 4: Apply the first value synchronously**

`ApplyValuePlugin` becomes the only path. It must apply on mount in a `useLayoutEffect` so the editor never paints empty before the stored content lands, and it must normalize first:

```tsx
const result = normalizeValue(value, registeredNodeTypes(editor))
if (result.status === 'refused') {
  onUnsupported(result.unsupportedTypes)
  return
}
const applied = result.status === 'adapted' ? result.value : value
const nextState = editor.parseEditorState(JSON.stringify(applied))
```

Keep `{ tag: APPLY_VALUE_TAG }` on `setEditorState`, so the existing `OnChangePlugin` guard in `editor.tsx` continues to suppress the change event. Task 13 proves whether that suppression is sufficient; it is not assumed here.

Compare hashes against the **original** value, never the normalized one, so an adapted document does not read as a change on every mount.

- [ ] **Step 5: Add the two notices**

`AdaptedNotice` renders the exact sentence from the spec: *"This content contains formatting this editor no longer supports. Saving edits will use the supported formatting."* It is inline, not a dialog, and does not block editing. `UnsupportedContentNotice` names the unsupported content, states the field is read-only, and directs the reader to an administrator. Render it in place of the editable surface and set `editable` false when a refusal occurs.

- [ ] **Step 6: Run the package suite**

Run: `cd packages/richtext-lexical && pnpm vitest run --mode=jsdom && pnpm vitest run --mode=node`
Expected: PASS apart from the pre-existing `editor-component.test.tsx` assertion.

- [ ] **Step 7: Commit**

```bash
git add packages/richtext-lexical/src/field/
git commit -s -m "feat(richtext): adapted unsupported saved content on editor load"
```

---

### Task 13: Persistence behaviour

Suppressing `onChange` is necessary but does not establish safe persistence. These four cases specify behaviour by what the form submits, so assert on submitted values rather than on editor state.

**Files:**
- Test: `apps/webapp/src/__tests__/richtext-normalization-persistence.test.tsx`

**Interfaces:**
- Consumes: the editor field component and the form context from `@byline/admin/react`.

- [ ] **Step 1: Write the four failing tests**

Render the document editor form around a richtext field whose configuration no longer supports headings, seeded with a saved value containing one, and assert on the submitted payload.

```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { renderHeadinglessRichTextForm } from './support/render-richtext-form'

const SAVED_WITH_HEADING = {
  root: { children: [
    { children: [{ detail: 0, format: 0, mode: 'normal', style: '', text: 'Legacy title', type: 'text', version: 1 }],
      direction: null, format: '', indent: 0, type: 'heading', version: 1, tag: 'h1' },
  ], direction: null, format: '', indent: 0, type: 'root', version: 1 },
}

describe('persistence of adapted content', () => {
  it('submits nothing at all when the document is only opened', async () => {
    const onSubmit = vi.fn()
    const { submit } = renderHeadinglessRichTextForm({ value: SAVED_WITH_HEADING, onSubmit })
    await submit()
    // The contract is no submission, not a tolerable one. An untouched
    // document must produce no patch for any field.
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('emits no rich-text patch when an unrelated field is saved', async () => {
    const onSubmit = vi.fn()
    const { submit } = renderHeadinglessRichTextForm({ value: SAVED_WITH_HEADING, onSubmit })
    await userEvent.type(screen.getByLabelText('Title'), ' updated')
    await submit()
    const { patches } = onSubmit.mock.calls[0][0]
    expect(patches.map((patch: { path: string }) => patch.path)).toEqual(['title'])
    expect(patches.some((patch: { path: string }) => patch.path === 'body')).toBe(false)
  })

  it('submits the complete edited value on a rich-text save', async () => {
    const onSubmit = vi.fn()
    const { submit, typeInRichText } = renderHeadinglessRichTextForm({
      value: SAVED_WITH_HEADING,
      onSubmit,
    })
    await typeInRichText(' and more')
    await submit()
    const { patches } = onSubmit.mock.calls[0][0]
    const bodyPatch = patches.find((patch: { path: string }) => patch.path === 'body')
    expect(bodyPatch).toBeDefined()
    const body = JSON.stringify(bodyPatch.value)
    // The adaptation persists, the original text survives, and so does
    // the text just typed — a normalized save must not drop the edit.
    expect(body).not.toContain('"type":"heading"')
    expect(body).toContain('Legacy title')
    expect(body).toContain('and more')
  })

  it('emits no patch when an older version is restored but not edited', async () => {
    const onSubmit = vi.fn()
    const { submit, applyValue } = renderHeadinglessRichTextForm({ value: undefined, onSubmit })
    await applyValue(SAVED_WITH_HEADING)
    await submit()
    expect(onSubmit).not.toHaveBeenCalled()
  })
})
```

Write `support/render-richtext-form.tsx` alongside as part of this task. It mounts the admin `FormRenderer` around a two-field collection — a plain `text` field labelled "Title" and a richtext `body` field registered with `lexicalEditor((c) => { c.extensions.remove(builtInExtensions.Heading); return c })` — and returns `submit()`, `typeInRichText(text)` and `applyValue(value)` helpers. `submit()` must not call `onSubmit` when the form holds no patches, matching the real document-actions behaviour. The assertions are about submitted patches, never about editor state.

- [ ] **Step 2: Run them to watch them fail**

Run: `cd apps/webapp && pnpm vitest run --mode=jsdom src/__tests__/richtext-normalization-persistence.test.tsx`
Expected: cases 1, 2 and 4 fail if normalization marks the form dirty, because a dirty field produces a patch and `onSubmit` is called. Case 3 fails if the normalized value is not what is submitted, or if the newly typed text is lost when the adapted value is rebuilt.

- [ ] **Step 3: Make them pass**

If any of cases 1, 2 or 4 fail, the fix is in the value pipeline, not the test. The normalized value must reach the editor without entering the form's dirty-tracking or patch accumulation: it is a presentation of stored content, not an edit of it. Confirm `APPLY_VALUE_TAG` covers the path and that the hash comparison in `apply-value-plugin.tsx` uses the **original** value, not the normalized one, so a normalized document does not read as a change on every mount.

- [ ] **Step 4: Run the tests**

Run: `cd apps/webapp && pnpm vitest run --mode=jsdom src/__tests__/richtext-normalization-persistence.test.tsx`
Expected: PASS, four cases.

- [ ] **Step 5: Commit**

```bash
git add apps/webapp/src/__tests__/ packages/richtext-lexical/src/field/
git commit -s -m "test(richtext): pinned persistence behaviour for adapted content"
```

---

### Task 14: Clipboard and storage equivalence

The two paths now use different mechanisms, so their agreement has to be asserted rather than assumed. Require **equivalent structural outcomes and text preservation**, not exact parity: storage conversion deliberately preserves a link URL and an admonition title that clipboard import discards, and that difference is intended.

**Files:**
- Test: `packages/richtext-lexical/src/field/normalize/clipboard-equivalence.test.tsx`

- [ ] **Step 1: Write the tests**

For each structure in the spec's table, build the node in a full editor, produce both a clipboard paste into a restricted editor and a normalized load of the same content, and assert the resulting block types match and the text is preserved on both routes.

```tsx
import { $getRoot } from 'lexical'
import { describe, expect, it, vi } from 'vitest'

import { registeredNodeTypes } from '../capabilities/registered-node-types'
import { normalizeValue } from './normalize-value'
import { buildFullEditor, buildRestrictedEditor, parseHtmlToTypes } from '../test-support/build-test-editor'

/** Block types and text produced by loading `saved` through the normalizer. */
function viaStorage(saved: any) {
  const editor = buildRestrictedEditor()
  const result = normalizeValue(saved, registeredNodeTypes(editor))
  if (result.status !== 'adapted') throw new Error(`expected adapted, got ${result.status}`)
  let types: string[] = []
  let text = ''
  const state = editor.parseEditorState(JSON.stringify(result.value))
  state.read(() => {
    types = $getRoot().getChildren().map((n) => n.getType())
    text = $getRoot().getTextContent()
  })
  editor.dispose()
  return { types, text }
}

/** Block types and text produced by pasting the equivalent HTML. */
function viaClipboard(html: string) {
  const editor = buildRestrictedEditor()
  const { types, text } = parseHtmlToTypes(editor, html)
  editor.dispose()
  return { types, text }
}

describe('clipboard and storage agree', () => {
  it('produces equivalent structure and text for a heading', () => {
    const saved = { root: { children: [
      { children: [{ detail: 0, format: 0, mode: 'normal', style: '', text: 'Title', type: 'text', version: 1 }],
        direction: null, format: '', indent: 0, type: 'heading', version: 1, tag: 'h1' },
    ], direction: null, format: '', indent: 0, type: 'root', version: 1 } }
    const storage = viaStorage(saved)
    const clipboard = viaClipboard('<h1>Title</h1>')
    expect(storage.types).toEqual(clipboard.types)
    expect(storage.text).toContain('Title')
    expect(clipboard.text).toContain('Title')
  })

  it('preserves the link URL on the storage route only', () => {
    const saved = { root: { children: [
      { children: [{ children: [{ detail: 0, format: 0, mode: 'normal', style: '', text: 'link text', type: 'text', version: 1 }],
          direction: null, format: '', indent: 0, type: 'link', version: 1, url: 'https://example.com' }],
        direction: null, format: '', indent: 0, type: 'paragraph', version: 1 },
    ], direction: null, format: '', indent: 0, type: 'root', version: 1 } }
    const storage = viaStorage(saved)
    const clipboard = viaClipboard('<p><a href="https://example.com">link text</a></p>')
    // Equivalent structure and text, deliberately NOT identical content.
    expect(storage.types).toEqual(clipboard.types)
    expect(storage.text).toContain('link text')
    expect(storage.text).toContain('https://example.com')
    expect(clipboard.text).toContain('link text')
  })
})
```

Add the Lexical-to-Lexical fallthrough case: a clipboard carrying `application/x-lexical-editor` with a heading plus `text/html`, pasted into a restricted editor, must not throw, must produce a paragraph, and must preserve the text. The Lexical branch throws internally and `$defaultLexicalEditorImporter` catches it, logs through `console.error`, and returns `$next()`; spy on `console.error` and assert the fallthrough happened rather than suppressing it.

Add the no-HTML case the review asked for: a clipboard carrying only `application/x-lexical-editor` and `text/plain`. The compatibility guarantee must not depend on HTML being present. Assert no throw and that the text survives. Inline formatting is lost on this route because plain text carries none — assert text preservation only.

- [ ] **Step 2: Run them**

Run: `cd packages/richtext-lexical && pnpm vitest run --mode=jsdom src/field/normalize/clipboard-equivalence.test.tsx`
Expected: PASS. A mismatch here is a real defect in Task 11's table, not a test to relax.

- [ ] **Step 3: Commit**

```bash
git add packages/richtext-lexical/src/field/normalize/clipboard-equivalence.test.tsx
git commit -s -m "test(richtext): asserted clipboard and storage conversions agree"
```

---

### Task 15: Capability manifest and scan script

Operators need to know which stored documents will be adapted, and which will open read-only, before they upgrade. The work is split at a manifest boundary because field configuration cannot be loaded in plain Node — see the decision above.

**Files:**
- Create: `packages/richtext-lexical/src/scan/capability-manifest.ts`
- Create: `packages/richtext-lexical/src/scan/scan-documents.ts`
- Create: `apps/webapp/byline/scripts/richtext-capabilities.ts`
- Create: `apps/webapp/byline/scripts/richtext-scan.ts`
- Test: `packages/richtext-lexical/src/scan/scan-documents.test.node.ts`

**Interfaces:**
- Produces:

```ts
export interface FieldCapabilities { collectionPath: string; fieldPath: string; supportedTypes: string[] }
export type CapabilityManifest = FieldCapabilities[]
export interface ScanFinding {
  collectionPath: string; fieldPath: string; documentId: string; versionId: string
  adaptedTypes: string[]; refusedTypes: string[]
}
export function scanDocument(
  value: SerializedEditorState, capabilities: FieldCapabilities,
  ids: { documentId: string; versionId: string }
): ScanFinding | undefined
```

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest'

import { scanDocument } from './scan-documents'

const caps = { collectionPath: 'publications', fieldPath: 'title', supportedTypes: ['root', 'paragraph', 'text'] }
const ids = { documentId: 'doc-1', versionId: 'ver-1' }
const doc = (...children: any[]) => ({ root: { children, direction: null, format: '', indent: 0, type: 'root', version: 1 } }) as any

describe('scanDocument', () => {
  it('reports nothing for a clean document', () => {
    expect(scanDocument(doc({ children: [], type: 'paragraph', version: 1 }), caps, ids)).toBeUndefined()
  })

  it('reports an adaptable heading', () => {
    const finding = scanDocument(doc({ children: [], type: 'heading', version: 1, tag: 'h1' }), caps, ids)
    expect(finding?.adaptedTypes).toEqual(['heading'])
    expect(finding?.refusedTypes).toEqual([])
  })

  it('reports a refusing inline image separately', () => {
    const finding = scanDocument(doc({ type: 'inline-image', version: 1 }), caps, ids)
    expect(finding?.refusedTypes).toEqual(['inline-image'])
  })

  it('reports findings against a localized, nested field path', () => {
    const nested = { ...caps, fieldPath: 'content.1.photoBlock.caption' }
    const finding = scanDocument(doc({ children: [], type: 'heading', version: 1, tag: 'h1' }), nested, ids)
    expect(finding?.fieldPath).toBe('content.1.photoBlock.caption')
  })

  it('reports an archived version distinctly from the current one', () => {
    const heading = doc({ children: [], type: 'heading', version: 1, tag: 'h1' })
    const current = scanDocument(heading, caps, { documentId: 'doc-1', versionId: 'ver-2' })
    const archived = scanDocument(heading, caps, { documentId: 'doc-1', versionId: 'ver-1' })
    expect(current?.versionId).toBe('ver-2')
    expect(archived?.versionId).toBe('ver-1')
  })
})
```

- [ ] **Step 2: Run it to watch it fail**

Run: `cd packages/richtext-lexical && pnpm vitest run --mode=node src/scan/scan-documents.test.node.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement scanning on top of the normalizer**

`scanDocument` runs `normalizeValue` against the field's supported set and maps the result: `unchanged` to `undefined`, `adapted` to `adaptedTypes`, `refused` to `refusedTypes`. Reusing the normalizer means the report cannot drift from the runtime behaviour it predicts.

`capability-manifest.ts` builds a `FieldCapabilities` entry by **building the editor** for that field's resolved `EditorConfig` and reading `registeredNodeTypes` from it:

```ts
export function capabilitiesFor(
  collectionPath: string,
  fieldPath: string,
  config: EditorConfig
): FieldCapabilities {
  // Build the real editor rather than re-deriving what it would
  // register. Walking declared `nodes` would recreate the extension
  // resolver — missing dependency-contributed nodes, conflicts and
  // replacements — and a manifest that disagrees with the runtime is
  // worse than no manifest.
  const editor = buildEditorFromExtensions(
    defineExtension({
      name: '[manifest]',
      namespace: config.lexical.namespace,
      dependencies: [ReactPluginHostExtension, ...(config.extensions ?? defaultExtensionsList()).toArray()],
    })
  )
  const supportedTypes = [...registeredNodeTypes(editor)]
  editor.dispose()
  return { collectionPath, fieldPath, supportedTypes }
}
```

This is the same construction the runtime performs, so the manifest cannot drift from what a field actually accepts.

- [ ] **Step 4: Wire the two scripts**

`richtext-capabilities.ts` loads the app's client config and writes the manifest to `byline/generated/richtext-capabilities.json`. Plain `tsx` fails here with `Unknown file extension ".css"`; register a Node module-resolution hook mapping `.css` to an empty module and try again. If module-scope browser access defeats that, fall back to a development-only admin route that produces the same JSON for download, and record which route was taken in the script's header comment.

`richtext-scan.ts` reads that manifest, iterates stored versions through the database adapter, calls `scanDocument` per richtext field, and prints a report grouped by collection: documents that will be adapted, and documents that will open read-only. Exit non-zero when any refusal is found, so it is usable as a pre-upgrade gate.

It must cover **every** version, not only current ones — the known FORRU case is a stray heading in an archived version — and every locale of a localized field. Walk richtext fields by their instance paths, so a field nested in a block or array (`content.1.photoBlock.caption`) is reached rather than only top-level fields.

- [ ] **Step 5: Run the script against the development database**

Run: `cd apps/webapp && pnpm tsx byline/scripts/richtext-capabilities.ts && pnpm tsx byline/scripts/richtext-scan.ts`
Expected: a manifest file and a report. A clean local database reports no findings and exits zero.

- [ ] **Step 6: Commit**

```bash
git add packages/richtext-lexical/src/scan/ apps/webapp/byline/scripts/
git commit -s -m "feat(richtext): added a pre-upgrade capability scan"
```

---

### Task 16: Downstream registrations, documentation and release notes

The configuration change is a clean break, so every registration moves in the same release. The doc comments that promise restriction the code did not deliver are corrected here too.

**Files:**
- Modify: `apps/webapp/byline/collections/**` (every `lexicalEditor(...)` registration)
- Modify: `packages/richtext-lexical/src/lexical-editor.tsx`, `src/config.ts`, `src/server.ts` doc comments
- Create: `docs/09-admin-ui/04-richtext-capabilities.md`
- Modify: `docs/09-admin-ui/index.md` — the section index lists its documents; a new file that is not listed there is unreachable

- [ ] **Step 1: Find every registration**

```bash
cd /Users/tony/Clients/Infonomic/Projects/Byline/Solutions/bylinecms.dev
grep -rn "options:\s*{\|textStyle\|markdownShortcutPlugin\|showTreeView\|richText:" apps/webapp/byline --include=*.ts --include=*.tsx
```

- [ ] **Step 2: Migrate each one**

Apply the mapping: `richText` to `mode`, `markdownShortcutPlugin` to `markdownShortcuts`, `showTreeView` to `controls.treeView`, `textStyle` to `controls.blockFormat`, and `inlineCode`, `undoRedo`, `textAlignment`, `markdownToggle` to their `controls` equivalents. `debug` moves to the top level.

Where a registration used `textStyle: false` to mean "no headings", that intent is now expressed by removing the extension: `c.extensions.remove(builtInExtensions.Heading)`. Read each call site and decide which was meant — hiding the control, disabling the capability, or both. This is the substance of the fix, not a mechanical rename.

- [ ] **Step 3: Correct the misleading doc comments**

Any comment claiming a preset restricts content must either become true or say what it actually does. State plainly that `controls` flags hide affordances, that capabilities come from the extensions list, and that bold, italic and inline code cannot be constrained by either.

- [ ] **Step 4: Write the reference document**

`docs/09-admin-ui/04-richtext-capabilities.md` follows the repository documentation style: YAML front matter with `title`, `path` and a one-sentence `summary`, one H1 matching the front-matter title exactly, and a `Companions:` list immediately below. Cover what a capability is, how removing an extension changes what a field accepts, what `controls` does and does not do, the conversion table, the read-only refusal, and the scan script. State the `TextNode` limitation explicitly rather than implying it away.

Add the matching entry to `docs/09-admin-ui/index.md`, following the existing one-line-per-document pattern used for `02-admin-config-registration.md` and `03-collection-groups.md`.

Invoke the `/document` skill for this step: it carries the repository's writing standard and verification workflow, which `pnpm docs:check` only partly enforces.

- [ ] **Step 5: Verify the whole workspace**

Run: `pnpm lint && pnpm typecheck && pnpm test && pnpm docs:check && git diff --check`
Expected: PASS. `editor-component.test.tsx` carries one pre-existing failure from `develop`; confirm it is the same assertion and no others.

- [ ] **Step 6: Commit**

```bash
git add apps/webapp/byline docs/ packages/richtext-lexical/src
git commit -s -m "feat(richtext)!: migrated registrations to the capability and control model"
```

---

## Verification summary

Run before calling the work complete:

```bash
pnpm lint && pnpm typecheck && pnpm test
cd packages/richtext-lexical && pnpm vitest run --mode=jsdom && pnpm vitest run --mode=node
cd apps/webapp && pnpm vitest run --mode=jsdom
```

The spec's five required scenarios map to tasks as follows: HTML paste to Task 5, Lexical-to-Lexical paste to Task 14, keyboard commands to Task 8, Markdown shortcuts to Task 7, loading a previously saved value to Tasks 11 to 13, and the `defaultExtensionsList()` no-regression case to Task 5.
