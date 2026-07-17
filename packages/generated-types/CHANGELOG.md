# @byline/generated-types

## 4.2.0

### Minor Changes

- added per-block admin config (`defineBlockAdmin`) and a dedicated `code` field with a CodeMirror 6 admin widget
  added `upload.location` storage scoping, friendly upload keys with a configurable filename slugifier, and `itemViewSort` for relation pickers

## 4.1.0

### Minor Changes

- moved the typed server clients to `@byline/client/server` (Register declaration merge, `HostRequestBridge` seam in core) and app collection types to the new `@byline/generated-types` stub — codegen format 2, app-local `clients.server.ts` shim removed
