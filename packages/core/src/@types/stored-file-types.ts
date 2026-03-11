// ---------------------------------------------------------------------------
// Data types for file fields
// ---------------------------------------------------------------------------

export interface StoredFileValue {
  file_id: string
  filename: string
  original_filename: string
  mime_type: string
  file_size: number
  storage_provider: string
  storage_path: string
  storage_url?: string
  file_hash?: string
  image_width?: number
  image_height?: number
  image_format?: string
  processing_status: 'pending' | 'processing' | 'complete' | 'failed'
  thumbnail_generated?: boolean
}

// export interface StoredFileValue {
//   file_id: string
//   filename: string
//   original_filename: string
//   mime_type: string
//   file_size: string
//   storage_provider: string
//   storage_path: string
//   storage_url: string | null
//   file_hash: string | null
//   image_width: number | null
//   image_height: number | null
//   image_format: string | null
//   processing_status: 'pending' | 'processing' | 'complete' | 'failed'
//   thumbnail_generated: boolean
// }

/**
 * A placeholder StoredFileValue used when an image/file is selected but not yet
 * uploaded. This allows the form to hold the file's preview URL while deferring
 * the actual upload until Save.
 */
export interface PendingStoredFileValue {
  file_id: string
  filename: string
  original_filename: string
  mime_type: string
  file_size: string
  storage_provider: 'pending'
  storage_path: ''
  storage_url: string // blob URL for local preview
  file_hash: null
  image_width: number | null
  image_height: number | null
  image_format: null
  processing_status: 'pending'
  thumbnail_generated: false
}

/**
 * Type guard to check if a StoredFileValue represents a pending (not yet uploaded) file.
 */
export function isPendingStoredFileValue(value: unknown): value is PendingStoredFileValue {
  if (!value || typeof value !== 'object') return false
  const v = value as Partial<StoredFileValue>
  return v.storage_provider === 'pending'
}

/**
 * Create a pending placeholder value for a file that is selected but not yet uploaded.
 */
export function createPendingStoredFileValue(
  file: File,
  previewUrl: string,
  dimensions?: { width: number; height: number }
): PendingStoredFileValue {
  return {
    file_id: `pending-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    filename: file.name,
    original_filename: file.name,
    mime_type: file.type,
    file_size: String(file.size),
    storage_provider: 'pending',
    storage_path: '',
    storage_url: previewUrl,
    file_hash: null,
    image_width: dimensions?.width ?? null,
    image_height: dimensions?.height ?? null,
    image_format: null,
    processing_status: 'pending',
    thumbnail_generated: false,
  }
}
