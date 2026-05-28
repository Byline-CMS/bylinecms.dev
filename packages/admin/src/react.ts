/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Single React barrel for `@byline/admin`. Hosts every client-side
 * surface the admin shell needs to render the document editor —
 * presentational layout primitives, field widgets, the form runtime,
 * the editor-shared widgets (status badge, diff modal), and the
 * field-side services Context. Generic drag-and-drop helpers
 * (`DraggableSortable`, `useSortable`, `moveItem`) live in
 * `@byline/ui/react` since they embed no CMS concepts.
 *
 * Why one barrel: per-area subpath exports break React Context
 * identity under bundlers that pre-bundle subpaths individually
 * (e.g. Vite's `optimizeDeps.include`) — a provider mounted on one
 * Context identity and a hook reading another. A single specifier
 * eliminates the trap structurally. Tree-shaking inside the ESM
 * bundle still drops anything unused by the host.
 *
 * Sibling subpaths in this package — `@byline/admin/admin-users`,
 * `@byline/admin/admin-roles/components/*`, `@byline/admin/auth`,
 * etc. — host per-vertical components and server-side modules;
 * those are intentionally separate so server-only imports don't pull
 * React.
 */

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
export * from './fields/field-services-context.js'
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
// Presentational admin layout primitives.
export * from './presentation/group.js'
export * from './presentation/row.js'
export * from './presentation/tabs.js'
// Collection-editor-shared widgets.
export * from './widgets/diff-viewer/diff-modal.js'
export * from './widgets/status-badge/status-badge.js'
// Field-side service contract types.
export type {
  BylineFieldServices,
  CollectionListDoc,
  CollectionListParams,
  CollectionListResponse,
  GetCollectionDocumentsFn,
  UploadedFileResult,
  UploadFieldFn,
} from './fields/field-services-types.js'
