/**
 * NOTE: We put a .js ending on imports here to satisfy
 * TS / dist output
 */

// Foundational surface — synced from @infonomic/uikit. See
// scripts/sync-from-uikit.sh and src/.uikit-sync.json.
export * from './uikit.js'

// Specialized subsystems live under their own subpath exports:
//   @byline/ui/admin     — see src/admin.ts
//   @byline/ui/fields    — see src/fields.ts
//   @byline/ui/forms     — see src/forms.ts
//   @byline/ui/services  — see src/services.ts

// Drag-and-drop helpers stay in the root barrel for now.
export * from './dnd/draggable-sortable/index.js'
