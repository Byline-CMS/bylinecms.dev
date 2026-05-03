'use client'

import type React from 'react'

import { Button, type Intent } from '@infonomic/uikit/react'
import cx from 'classnames'

import { LangLink } from '@/i18n/components/lang-link'
import type { Locale } from '@/i18n/i18n-config'

export interface LinkFieldAttributes {
  id?: string | null
  type?: ('reference' | 'custom') | null
  newTab?: boolean | null
  label: string
  customId?: string | null
  url?: string | null
  appearance?: ('primary' | 'secondary') | null
  reference?: {
    value: string
    relationTo: string
    data: {
      id: string
      title: string
      slug: string
      collectionAlias: string
    }
  }
}

export interface LinkFieldProps extends React.ComponentPropsWithoutRef<'a'> {
  link: LinkFieldAttributes
  size?: 'sm' | 'md' | 'lg'
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

function getHref(args: LinkFieldAttributes): string {
  let href = ''
  const publicWebsiteUrl = '/' // getPublicWebsiteUrl()
  const { type, url } = args

  if ((type === 'custom' || type === undefined) && url != null) {
    href = url
  } else if (
    type === 'reference' &&
    args.reference?.relationTo != null &&
    args.reference?.data?.slug != null
  ) {
    const collection = args?.reference?.relationTo
    // biome-ignore lint/correctness/noUnsafeOptionalChaining: To be refactored in the future
    const { slug, collectionAlias } = args?.reference?.data
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
  args: LinkFieldAttributes,
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

/**
 * DefaultLink
 * @param param0
 * @returns
 */
export function DefaultLink({
  link,
  lng,
  className,
  onMouseEnter,
  onMouseLeave,
  ...rest
}: LinkFieldProps): React.JSX.Element {
  const href = getHref(link)
  const additionalProps = getAdditionalProps(link, href)

  if (href.startsWith('/')) {
    return (
      <LangLink
        lng={lng}
        to={href}
        {...additionalProps}
        className={className}
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
        {...rest}
      >
        {link.label}
      </LangLink>
    )
  }
  return (
    <a
      href={href}
      {...additionalProps}
      className={cx(className, '!no-underline')}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      {...rest}
    >
      <span className="underline">{link.label}</span>
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

/**
 * ButtonLink
 * @param param0
 * @returns
 */
export function ButtonLink({
  link,
  size = 'md',
  lng,
  className,
  onMouseEnter,
  onMouseLeave,
  ...rest
}: LinkFieldProps): React.JSX.Element {
  const href = getHref(link)
  const additionalProps = getAdditionalProps(link, href)

  if (href.startsWith('/')) {
    return (
      <Button
        intent={link?.appearance as Intent}
        size={size}
        render={
          <LangLink
            lng={lng}
            to={href}
            {...additionalProps}
            className={cx(className, '!no-underline')}
            onMouseEnter={onMouseEnter}
            onMouseLeave={onMouseLeave}
            {...rest}
          />
        }
      >
        {link.label}
      </Button>
    )
  }
  return (
    <Button
      intent={link?.appearance as Intent}
      size={size}
      render={
        <a
          href={href}
          {...additionalProps}
          className={cx(className, '!no-underline')}
          onMouseEnter={onMouseEnter}
          onMouseLeave={onMouseLeave}
          {...rest}
        />
      }
    >
      {link.label}
    </Button>
  )
}

/**
 * We export LinkField which will attempt to automatically switch
 * between ButtonLink and DefaultLink based on the appearance of the link.
 *
 * For more control including className and style overrides, a block may
 * choose to use the above ButtonLink or DefaultLink directly.
 *
 * @param param0
 * @returns
 */
export function LinkField({
  link,
  lng,
  size = 'md',
  className,
  onMouseEnter,
  onMouseLeave,
  ...rest
}: LinkFieldProps): React.JSX.Element {
  if (
    link.appearance != null &&
    (link.appearance === 'primary' || link.appearance === 'secondary')
  ) {
    return (
      <ButtonLink
        size={size}
        link={link}
        lng={lng}
        className={className}
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
        {...rest}
      />
    )
  }
  return (
    <DefaultLink
      link={link}
      lng={lng}
      className={className}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      {...rest}
    />
  )
}
