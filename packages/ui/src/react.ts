/**
 * NOTE: We put a .js ending on imports here to satisfy
 * TS / dist output.
 *
 * Single unified entry point for `@byline/ui`.
 *
 * Scope: framework-agnostic React primitives — uikit foundations
 * (Button, Input, Modal, Drawer, Alert, Table, icons, …) plus the
 * widgets that remained generic after the admin extraction (datepicker,
 * search, timeline, image-lightbox). No CMS concepts, no admin-specific
 * Contexts.
 *
 * Admin-domain React surface — forms, fields, presentational form
 * layout (tabs/rows/groups), drag-and-drop helpers used by sortable
 * fields, the field-side services Context, and the editor-shared
 * widgets (status-badge, diff-viewer) — lives in `@byline/admin/react`.
 * Server-only admin modules (admin-users, admin-roles, etc.) stay on
 * their own per-vertical subpaths inside `@byline/admin`.
 *
 * One barrel rather than per-area subpath exports: bundlers that
 * pre-bundle subpaths individually (e.g. Vite's `optimizeDeps.include`)
 * would inline a private copy of any React Context per subpath —
 * provider mounted on one identity, hooks reading another. Collapsing
 * to a single specifier eliminates the trap structurally.
 */

// Generic vertical-list sortable helpers over @dnd-kit/sortable. No
// CMS concepts in the API — callers pass ids + an onDragEnd callback.
export * from './dnd/draggable-sortable/index.js'
// Foundational surface — synced from @infonomic/uikit. See
// scripts/sync-from-uikit.sh and src/.uikit-sync.json.
export * from './uikit.js'
