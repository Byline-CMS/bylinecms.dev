/**
 * Normalize an untrusted redirect target to a same-origin, root-relative URL.
 * Encoded path data is rejected rather than decoded so traversal and URL parser
 * differences cannot change the destination after validation.
 */
export function normalizeRootRelativeRedirect(value: string): string | undefined {
  if (value.length === 0 || value !== value.trim()) return undefined
  if (!value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return undefined
  if (hasUnsafeCodePoint(value)) return undefined

  const pathname = value.split(/[?#]/, 1)[0]
  if (!pathname || pathname.includes('%')) return undefined
  if (pathname.split('/').some((segment) => segment === '.' || segment === '..')) return undefined

  let url: URL
  try {
    url = new URL(value, 'https://byline.invalid')
  } catch {
    return undefined
  }

  if (url.origin !== 'https://byline.invalid') return undefined
  return `${url.pathname}${url.search}${url.hash}`
}

function hasUnsafeCodePoint(value: string): boolean {
  return Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0) ?? 0
    return (
      codePoint <= 0x1f ||
      codePoint === 0x7f ||
      (codePoint >= 0x80 && codePoint <= 0x9f) ||
      (codePoint >= 0xd800 && codePoint <= 0xdfff)
    )
  })
}
