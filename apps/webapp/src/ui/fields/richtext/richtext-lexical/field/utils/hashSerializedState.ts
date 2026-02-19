import type { SerializedEditorState } from 'lexical'

// Simple FNV-1a hash for serialized editor state.
// Used to detect external value changes without deep-equality costs.
export function hashSerializedState(state: SerializedEditorState | string): string {
  const str = typeof state === 'string' ? state : stableJsonStringify(state)
  let hash = 2166136261 >>> 0

  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }

  return (hash >>> 0).toString(16)
}

function stableJsonStringify(value: unknown): string {
  // Lexical/Payload states are plain JSON-ish objects.
  // We sort object keys to ensure semantically identical objects hash the same,
  // even if key insertion order differs (e.g. { relationTo, value } vs { value, relationTo }).
  return JSON.stringify(value, (_key, val) => {
    if (val == null) return val
    if (Array.isArray(val)) return val
    if (typeof val !== 'object') return val

    const obj = val as Record<string, unknown>
    const keys = Object.keys(obj).sort()
    const sorted: Record<string, unknown> = {}
    for (const key of keys) {
      sorted[key] = obj[key]
    }
    return sorted
  })
}
