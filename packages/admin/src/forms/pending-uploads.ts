interface PendingUploadLike {
  previewUrl: string
}

/** Remove deferred uploads belonging to one repeating item and its descendants. */
export function deletePendingUploadsUnderPath<T extends PendingUploadLike>(
  uploads: Map<string, T>,
  itemPath: string,
  revokeObjectURL: (url: string) => void
): boolean {
  const descendantPrefix = `${itemPath}.`
  let deleted = false

  for (const [fieldPath, upload] of uploads) {
    if (fieldPath !== itemPath && !fieldPath.startsWith(descendantPrefix)) continue
    revokeObjectURL(upload.previewUrl)
    uploads.delete(fieldPath)
    deleted = true
  }

  return deleted
}
