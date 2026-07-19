/** Return a canonical identity that is safe in an instance-path selector. */
export function repeatingItemId(item: unknown): string | undefined {
  if (item == null || typeof item !== 'object' || !('_id' in item)) return undefined
  const id = (item as { _id: unknown })._id
  return typeof id === 'string' && id !== '' && !/[.[\]]/.test(id) ? id : undefined
}

/**
 * Address an array/block item by stable identity when its id is path-safe.
 * Positional fallback is retained for noncanonical create defaults and legacy
 * adapter data that does not carry storage identity yet.
 */
export function repeatingItemPath(parentPath: string, item: unknown, index: number): string {
  const id = repeatingItemId(item)
  return id != null ? `${parentPath}[id=${id}]` : `${parentPath}[${index}]`
}

export interface RepeatingItemMove<T> {
  items: T[]
  itemId: string
  fromIndex: number
  toIndex: number
}

/** Build one synchronized form-store move and its matching patch identity. */
export function moveRepeatingItems<T>(
  items: readonly T[],
  moveFromIndex: number,
  moveToIndex: number
): RepeatingItemMove<T> | null {
  if (items.length === 0) return null

  const fromIndex = Math.max(0, Math.min(moveFromIndex, items.length - 1))
  const toIndex = Math.max(0, Math.min(moveToIndex, items.length - 1))
  if (fromIndex === toIndex) return null

  const source = items[fromIndex]
  const moved = [...items]
  const [item] = moved.splice(fromIndex, 1)
  moved.splice(toIndex, 0, item as T)

  return {
    items: moved,
    itemId: repeatingItemId(source) ?? String(fromIndex),
    fromIndex,
    toIndex,
  }
}
