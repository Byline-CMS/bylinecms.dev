'use client'

import type React from 'react'

import cx from 'classnames'

import { LangLink } from '@/i18n/components/lang-link'
import type { Locale } from '@/i18n/i18n-config'

// import { getPublicWebsiteUrl } from '@/utils/utils.framework.ts'

export interface LinkAttributes {
  linkType?: 'custom' | 'internal'
  newTab?: boolean
  nofollow?: boolean
  rel?: string
  url?: string
  doc?: {
    value: string
    relationTo: string
    data: {
      id: string
      title: string
      slug: string
      area: string
      collectionAlias: string
    }
  }
}

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

function getHref(args: LinkAttributes): string {
  let href = ''
  const publicWebsiteUrl = '/' // getPublicWebsiteUrl()
  const { linkType, url } = args

  if ((linkType === 'custom' || linkType === undefined) && url != null) {
    href = url
  } else if (
    linkType === 'internal' &&
    args.doc?.relationTo != null &&
    args.doc?.data?.slug != null
  ) {
    const collection = args.doc.relationTo
    const { slug, area, collectionAlias } = args.doc.data
    if (collectionAlias != null) {
      // The alias might be for the root
      if (collectionAlias.length === 0) {
        href = `/${slug}`
      } else {
        href = `/${collectionAlias}/${slug}`
      }
    } else {
      href = `/${collection}/${slug}`
    }

    if (area != null && area.length > 0 && area !== 'root') {
      href = `/${area}${href}`
    }
  }

  const hrefIsLocal = ['tel:', 'mailto:', '/'].some((prefix) => href.startsWith(prefix))
  if (!hrefIsLocal) {
    try {
      const objectURL = new URL(href)
      if (objectURL.origin === publicWebsiteUrl) {
        href = objectURL.href.replace(publicWebsiteUrl, '')
      }
    } catch (e) {
      console.error(`Failed to format url: ${href}`, e) // eslint-disable-line no-console
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

  if (!href.startsWith('/')) {
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
