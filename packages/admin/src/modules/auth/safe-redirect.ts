import { normalizeRootRelativeRedirect as normalizeCoreRedirect } from '@byline/core'

/** Accept only canonical, unencoded, root-relative same-origin redirect paths. */
export function normalizeRootRelativeRedirect(value: string): string | undefined {
  const normalized = normalizeCoreRedirect(value)
  if (!normalized) return undefined

  // Keep an origin check next to the navigation sink even if core validation changes.
  let url: URL
  try {
    url = new URL(normalized, 'https://byline.invalid')
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
