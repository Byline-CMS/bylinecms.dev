/** Compare reconstructed field data without treating omitted optional keys as edits. */
export function sameDocumentData(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true
  if (left instanceof Date && right instanceof Date) return left.getTime() === right.getTime()
  if (left === null || right === null || typeof left !== 'object' || typeof right !== 'object')
    return false
  if (Array.isArray(left) || Array.isArray(right))
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((value, index) => sameDocumentData(value, right[index]))
    )
  const a = left as Record<string, unknown>,
    b = right as Record<string, unknown>
  const keys = new Set([...Object.keys(a), ...Object.keys(b)])
  return [...keys].every((key) => sameDocumentData(a[key], b[key]))
}
