/**
 * Barrel re-exports for admin collection operations.
 *
 * Each module is self-contained: it defines the TanStack Start server
 * function and exports a clean public API. The upload module is the
 * sole exception — it uses a raw fetch() wrapper because multipart
 * FormData cannot be serialised through a createServerFn JSON-RPC body.
 */

export * from './create'
export * from './delete'
export * from './get'
export * from './history'
export * from './list'
export * from './stats'
export * from './status'
export * from './update'
export * from './upload'
