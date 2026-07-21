# @byline/generated-types

## 4.6.0

### Minor Changes

- added per-user list-view preferences (page-size + sort persistence) and return-to-list editor state, backed by a new `byline_admin_user_preferences` table and admin-preferences module

## 4.5.0

### Minor Changes

- added ComboButton menu icons, MarkdownIcon, and a dropdown anchor prop to `@byline/ui`
  fixed modal overlay-click dismissal and nested-heading anchor id derivation

## 4.4.1

### Patch Changes

- fixed admin form paths losing their target after a block or array reorder — items are now addressed by stable id, so edits, conditions and deferred uploads follow their own item. **`FieldHookContext.path`** and hook `setFieldValue` paths now use `[id=…]` selectors instead of positional indices

  tightened field path validation in **`@byline/core`** — bracket characters are rejected in field and block names, and a malformed path is reported as malformed rather than as a wrong-dialect index

## 4.4.0

### Minor Changes

- fixed upload fields declared inside blocks — **`@byline/admin`** now renders the drop zone and resolves `upload.context` against the addressed block
  added a shared field path grammar in **`@byline/core`**; boot now rejects unresolvable `search` config names and malformed patch paths

## 4.3.0

### Minor Changes

- arrays inside blocks are now fully editable and drag-sortable, and dotted schema-path keys let field admin overrides reach nested declarations (`faq.answer`);
  fixed patch aliasing that duplicated array items added inside a just-added block, and array items now validate against their child field schemas

## 4.2.0

### Minor Changes

- added per-block admin config (`defineBlockAdmin`) and a dedicated `code` field with a CodeMirror 6 admin widget
  added `upload.location` storage scoping, friendly upload keys with a configurable filename slugifier, and `itemViewSort` for relation pickers

## 4.1.0

### Minor Changes

- moved the typed server clients to `@byline/client/server` (Register declaration merge, `HostRequestBridge` seam in core) and app collection types to the new `@byline/generated-types` stub — codegen format 2, app-local `clients.server.ts` shim removed
