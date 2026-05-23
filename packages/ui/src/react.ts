/**
 * NOTE: We put a .js ending on imports here to satisfy
 * TS / dist output.
 *
 * Single unified entry point for `@byline/ui`. Everything React-side
 * exports through this barrel — uikit foundations, drag-and-drop
 * helpers, presentational admin layout primitives, field widgets, form
 * runtime, and the field-side service contracts.
 *
 * Why one barrel: previous releases split this into per-area subpath
 * exports (`./react/admin`, `./react/fields`, `./react/forms`,
 * `./react/services`). Bundlers that pre-bundle subpaths individually
 * (e.g. Vite's `optimizeDeps.include`) would inline a private copy of
 * the React Contexts in `services/*` per subpath — provider mounted on
 * one Context identity, hooks reading another. Collapsing to a single
 * specifier eliminates the trap structurally. Tree-shaking inside the
 * single ESM bundle handles unused exports for public-site consumers
 * (sideEffects is set to CSS only).
 *
 * Admin-domain components (admin users, roles, permissions, account
 * self-service, sign-in form, admin services context) live in
 * `@byline/admin` under per-vertical subpaths — they are no longer
 * exported from here. This package is the kit + form runtime +
 * collection-editor-shared widgets.
 */

// Presentational admin layout primitives.
export * from './admin/group.js'
export * from './admin/row.js'
export * from './admin/tabs.js'
// Drag-and-drop helpers.
export * from './dnd/draggable-sortable/index.js'
// Field widgets.
export * from './fields/array/array-field.js'
export * from './fields/blocks/blocks-field.js'
export * from './fields/checkbox/checkbox-field.js'
export * from './fields/column-formatter.js'
export * from './fields/date-time-formatter.js'
export * from './fields/datetime/datetime-field.js'
export * from './fields/draggable-context-menu.js'
export * from './fields/field-helpers.js'
export * from './fields/field-renderer.js'
export * from './fields/file/file-field.js'
export * from './fields/file/file-upload-field.js'
export * from './fields/group/group-field.js'
export * from './fields/image/image-field.js'
export * from './fields/image/image-upload-field.js'
export * from './fields/local-date-time.js'
export * from './fields/locale-badge.js'
export * from './fields/numerical/numerical-field.js'
export * from './fields/relation/relation-field.js'
export * from './fields/relation/relation-picker.js'
export * from './fields/select/select-field.js'
export * from './fields/sortable-item.js'
export * from './fields/text/text-field.js'
export * from './fields/text-area/text-area-field.js'
export * from './fields/use-field-change-handler.js'
// Form runtime.
export * from './forms/document-actions.js'
export * from './forms/form-context.js'
export * from './forms/form-renderer.js'
export * from './forms/navigation-guard.js'
export * from './forms/path-widget.js'
// Field-side service contract types + Context provider/hook.
export * from './services/field-services-context.js'
// Foundational surface — synced from @infonomic/uikit. See
// scripts/sync-from-uikit.sh and src/.uikit-sync.json.
export * from './uikit.js'
// Collection-editor-shared widgets.
export * from './widgets/diff-viewer/diff-modal.js'
export * from './widgets/status-badge/status-badge.js'
export type {
  BylineFieldServices,
  CollectionListDoc,
  CollectionListParams,
  CollectionListResponse,
  GetCollectionDocumentsFn,
  UploadedFileResult,
  UploadFieldFn,
} from './services/field-services-types.js'
