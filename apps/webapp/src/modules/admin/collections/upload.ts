export interface UploadDocumentResult {
  /** Present when the upload endpoint created a document (createDocument=true, the default). */
  documentId?: string
  documentVersionId?: string
  storedFile: {
    file_id: string
    filename: string
    original_filename: string
    mime_type: string
    file_size: string
    storage_provider: string
    storage_path: string
    storage_url: string
    file_hash: string | null
    image_width: number | null
    image_height: number | null
    image_format: string | null
    processing_status: 'complete' | 'pending' | 'failed'
    thumbnail_generated: boolean
  }
  variants: Array<{ name: string; url: string }>
}

/**
 * Upload a file to an upload-enabled collection.
 *
 * Uploads stay as HTTP requests — multipart FormData cannot be serialised
 * through a `createServerFn` JSON-RPC body, so this function remains a
 * thin fetch() wrapper against the public REST endpoint.
 *
 * @param collection      - collection path (e.g. `'media'`)
 * @param formData        - FormData with at minimum a `file` (File) field; may
 *                          also include `title`, `altText`, `caption`, `credit`,
 *                          `category`.
 * @param createDocument  - when `false`, the server stores the file and returns
 *                          the StoredFileValue but does NOT create a document
 *                          version. Use this when the upload is part of an
 *                          in-form field widget — the form's own save will
 *                          create the document. Defaults to `true`.
 */
export async function uploadDocument(
  collection: string,
  formData: FormData,
  createDocument = true
): Promise<UploadDocumentResult> {
  const base = `/admin/api/${collection}/upload`
  const url = createDocument ? base : `${base}?createDocument=false`
  const response = await fetch(url, {
    method: 'POST',
    // Do NOT set Content-Type manually — the browser must set the multipart
    // boundary automatically when body is FormData.
    body: formData,
  })
  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({}))
    throw new Error((errorBody as any).error || `Upload failed with status ${response.status}`)
  }
  return response.json() as Promise<UploadDocumentResult>
}
