'use client'

import type React from 'react'

import cx from 'classnames'

import { LangLink } from '@/i18n/components/lang-link'
import type { Locale } from '@/i18n/i18n-config'

// import { getPublicWebsiteUrl } from '@/utils/utils.framework.ts'

interface BaseLinkAttributes {
  newTab?: boolean
  nofollow?: boolean
  rel?: string | null
}

export interface CustomLinkAttributes extends BaseLinkAttributes {
  linkType?: 'custom'
  url?: string
}

/**
 * Internal link to a Byline document. Mirrors `DocumentRelation` —
 * `targetDocumentId` / `targetCollectionId` / `targetCollectionPath`
 * flattened onto the attributes, plus a `document` bag carrying the
 * canonical `{ title, path }` envelope embedded by the picker at write
 * time and refreshed by the server-side write-time embed walker.
 *
 * `document.path` has dual meaning during migration:
 *   - leading `/` — composed by `CollectionDefinition.buildDocumentPath`
 *     (or the generic `/${collectionPath}/${slug}` fallback) and treated
 *     as authoritative by this serializer.
 *   - no leading `/` — bare slug from `byline_document_paths`, either
 *     legacy data or a picker-time write that hasn't been through the
 *     walker yet. The serializer applies the generic compose fallback
 *     using `targetCollectionPath`.
 *
 * `document._resolved === false` means the most recent walker pass
 * could not find the target document (deleted between picker and
 * save / read). The serializer strips the `<a>` wrapper and renders
 * children as plain text — persisted state is preserved so an editor
 * can re-link later.
 */
export interface InternalLinkAttributes extends BaseLinkAttributes {
  linkType: 'internal'
  targetDocumentId: string
  targetCollectionId: string
  targetCollectionPath: string
  document?: {
    title?: string
    path?: string
    _resolved?: false
  }
}

export type LinkAttributes = CustomLinkAttributes | InternalLinkAttributes

export type LinkType = 'internal' | 'custom'

export interface LinkLexicalProps {
  attributes: LinkAttributes
  lng: Locale
  className?: string
  onMouseEnter?: () => void
  onMouseLeave?: () => void
  children?: React.ReactNode
}

export function manageRel(input: string, action: 'add' | 'remove', value: string): string {
  let result: string
  let mutableInput = `${input}`
  if (action === 'add') {
    // if we somehow got out of sync - clean up
    if (mutableInput.includes(value)) {
      const re = new RegExp(value, 'g')
      mutableInput = mutableInput.replace(re, '').trim()
    }
    mutableInput = mutableInput.trim()
    result = mutableInput.length === 0 ? `${value}` : `${mutableInput} ${value}`
  } else {
    const re = new RegExp(value, 'g')
    result = mutableInput.replace(re, '').trim()
  }
  return result
}

// Hrefs we treat as "stays in the page / app" — skip URL parsing,
// skip the external-link icon, don't force `target="_blank"`. `#anchor`
// is an intra-page jump; empty hrefs would be inert placeholders but
// `LinkLexicalSerializer` short-circuits those before reaching here.
function isLocalHref(href: string): boolean {
  if (href.length === 0) return true
  if (href.startsWith('#')) return true
  return ['tel:', 'mailto:', '/'].some((prefix) => href.startsWith(prefix))
}

/**
 * Resolve the renderable href for a link node. Returns `''` when no
 * usable href can be built — the serializer treats that as the signal
 * to strip the `<a>` / `<LangLink>` wrapper and render children plain.
 *
 * Internal-link fallback chain (see docs/04-collections/06-rich-text.md):
 *   1. `document._resolved === false` → strip wrapper.
 *   2. `document.path` starts with `/` → use as-is (canonicalised by
 *      the server-side embed walker via `buildDocumentPath`).
 *   3. `document.path` is a bare slug + `targetCollectionPath` present
 *      → generic compose `/${targetCollectionPath}/${path}`. Heal-on-
 *      write fallback for legacy nodes and picker-time-but-not-yet-
 *      walked sessions.
 *   4. Neither — strip wrapper.
 */
function getHref(args: LinkAttributes): string {
  let href = ''
  const publicWebsiteUrl = '/' // getPublicWebsiteUrl()

  if (args.linkType === 'internal') {
    // Step 1 — walker explicitly marked the target as missing.
    if (args.document?._resolved === false) return ''

    const path = args.document?.path
    if (path != null && path.length > 0) {
      if (path.startsWith('/')) {
        // Step 2 — canonical path written by the embed walker.
        href = path
      } else if (args.targetCollectionPath) {
        // Step 3 — bare slug, generic compose fallback.
        href = `/${args.targetCollectionPath}/${path}`
      }
      // else: fall through to step 4 — empty href, wrapper stripped.
    }
  } else if (args.url != null) {
    href = args.url
  }

  if (!isLocalHref(href)) {
    // `new URL(href)` needs an ABSOLUTE URL (with a scheme); a relative custom
    // href like `../foo` or `foo/bar` would throw "Invalid URL". Only attempt
    // to normalise absolute URLs — relative / scheme-less hrefs are left as
    // authored and rendered verbatim, rather than throwing and spamming the
    // console. (`mailto:` / `tel:` never reach here — `isLocalHref` claims them.)
    if (/^[a-z][a-z\d+.-]*:/i.test(href)) {
      try {
        const objectURL = new URL(href)
        if (objectURL.origin === publicWebsiteUrl) {
          href = objectURL.href.replace(publicWebsiteUrl, '')
        }
      } catch (e) {
        console.error(`Failed to format url: ${href}`, e) // eslint-disable-line no-console
      }
    }
  }

  return href
}

function getAdditionalProps(
  args: LinkAttributes,
  href: string
): {
  rel: string | undefined
  target: string | undefined
} {
  const additionalProps: {
    rel: string | undefined
    target: string | undefined
  } = {
    rel: undefined,
    target: undefined,
  }

  let rel = ''
  if (args.nofollow === true) rel = manageRel(rel, 'add', 'nofollow')
  if (args.newTab === true) rel = manageRel(rel, 'add', 'noopener')
  additionalProps.rel = rel

  if (args.newTab === true) {
    additionalProps.target = '_blank'
  }

  if (!isLocalHref(href)) {
    additionalProps.target = '_blank'
  }

  if (additionalProps.rel == null || additionalProps.rel.length === 0) delete additionalProps.rel
  if (additionalProps.target == null) delete additionalProps.target

  return additionalProps
}

export function LinkLexicalSerializer({
  attributes,
  lng,
  className,
  onMouseEnter,
  onMouseLeave,
  children,
}: LinkLexicalProps): React.JSX.Element {
  const href = getHref(attributes)

  // No usable href — render children plain (no anchor) so the public site
  // never carries a broken `<a href="">`. Covers `_resolved: false` and
  // every other empty-href branch of `getHref`. The admin editor reads
  // `__attributes` directly via Lexical APIs, so the link node stays
  // visible in the editor for re-linking.
  if (href.length === 0) {
    return <>{children}</>
  }

  const additionalProps = getAdditionalProps(attributes, href)

  if (href.startsWith('/')) {
    return (
      <LangLink
        lng={lng}
        to={href}
        {...additionalProps}
        className={cx(className, 'underline')}
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
      >
        {children}
      </LangLink>
    )
  }
  // Local but not a router path (#anchor, tel:, mailto:): plain
  // <a>, no external-link affordance.
  if (isLocalHref(href)) {
    return (
      <a
        href={href}
        {...additionalProps}
        className={cx(className, 'underline')}
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
      >
        {children}
      </a>
    )
  }
  return (
    <a
      href={href}
      {...additionalProps}
      className={cx(className, 'underline')}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <span className="underline">{children}</span>
      <span style={{ display: 'inline', whiteSpace: 'nowrap' }}>
        &#x202F;
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className="fill-[#001827] dark:fill-gray-50"
          style={{ display: 'inline' }}
          focusable="false"
          aria-hidden="true"
          height="14px"
          width="14px"
          viewBox="0 0 24 24"
        >
          <path d="M0 0h24v24H0V0z" fill="none" />
          <path d="M19 19H5V5h7V3H3v18h18v-9h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z" />
        </svg>
      </span>
    </a>
  )
}
