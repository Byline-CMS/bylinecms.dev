/** Accept only canonical, unencoded, root-relative same-origin redirect paths. */
export function normalizeRootRelativeRedirect(value: string): string | undefined {
  if (value.length === 0 || value !== value.trim()) return undefined
  if (!value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return undefined
  if (value.split(/[?#]/, 1)[0]?.includes('%')) return undefined
  if (
    Array.from(value).some((character) => {
      const code = character.charCodeAt(0)
      return code <= 31 || code === 127
    })
  ) {
    return undefined
  }

  let url: URL
  try {
    url = new URL(value, 'https://byline.invalid')
  } catch {
    return undefined
  }

  if (url.origin !== 'https://byline.invalid') return undefined
  return `${url.pathname}${url.search}${url.hash}`
}

/** Resolve the new prop first, then the deprecated prop, then a trusted fallback. */
export function resolveSignInFormRedirect(
  redirectTo: string | undefined,
  callbackUrl: string | undefined,
  fallback: string | (() => string)
): string {
  const requested =
    (redirectTo ? normalizeRootRelativeRedirect(redirectTo) : undefined) ??
    (callbackUrl ? normalizeRootRelativeRedirect(callbackUrl) : undefined)
  if (requested) return requested

  const defaultPath = typeof fallback === 'function' ? fallback() : fallback
  return normalizeRootRelativeRedirect(defaultPath) ?? '/'
}
