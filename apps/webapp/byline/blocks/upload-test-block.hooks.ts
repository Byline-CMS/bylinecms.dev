/** Server-only diagnostics for the temporary upload-test block. */
import type { AfterStoreContext, BeforeStoreContext, UploadHooks } from '@byline/core'

function contextValues(ctx: BeforeStoreContext | AfterStoreContext) {
  return {
    fieldName: ctx.fieldName,
    fieldPath: ctx.fields.fieldPath ?? null,
    documentId: ctx.fields.documentId ?? null,
    label: ctx.fields.label ?? null,
    caption: ctx.fields.caption ?? null,
    title: ctx.fields.title ?? null,
  }
}

export default {
  beforeStore: (ctx: BeforeStoreContext) => {
    console.log('[upload-test:beforeStore]', {
      ...contextValues(ctx),
      filename: ctx.filename,
      mimeType: ctx.mimeType,
      fileSize: ctx.fileSize,
    })
  },

  afterStore: (ctx: AfterStoreContext) => {
    console.log('[upload-test:afterStore]', {
      ...contextValues(ctx),
      storedFile: ctx.storedFile,
    })
  },
} satisfies UploadHooks
