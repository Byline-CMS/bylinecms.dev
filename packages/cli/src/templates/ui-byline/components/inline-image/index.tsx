'use client'

import type React from 'react'

import type { StoredFileValue } from '@byline/core'
import type { InlineImagePosition, SerializedInlineImageNode } from '@byline/richtext-lexical'
import { FadeInLift } from '@byline/ui/react'

import { ResponsiveImage } from '../responsive-image/index.tsx'
import { getHref, type LinkAttributes } from '../link/link-lexical.tsx'
import { LangLink } from '@/ui/byline/components/link/lang-link'
import type { Locale } from '@/ui/byline/types/i18n'
import type { SerializeOptions, SerializeProps } from '../richtext-lexical/serialize/index.tsx'

/**
 * Map the inline-image `position` (a layout choice the editor exposes
 * via radio buttons) onto the public renderer's `<ResponsiveImage>`
 * size cap and constrained-layout flag. Mirrors the editor-side
 * `variantFor()` heuristic in `@byline/richtext-lexical`'s
 * `inline-image-plugin/utils.ts` so the public render and the editor
 * preview agree on which variants matter.
 *
 * - `left` / `right` — floated 50% column on desktop. Cap at the tablet
 *    variant; flag `constrainedLayout` so the `sizes` hint halves the
 *    desktop viewport portion.
 * - `full` / `default` — main article column (~920px). Tablet cap is
 *    plenty; no extra constraint.
 * - `wide` — bleeds beyond the article. Full variant set; no constraint.
 */
const POSITION_TO_SIZE: Record<
  NonNullable<InlineImagePosition>,
  { size: 'large' | 'medium' | 'small'; constrainedLayout: boolean }
> = {
  left: { size: 'medium', constrainedLayout: true },
  right: { size: 'medium', constrainedLayout: true },
  full: { size: 'medium', constrainedLayout: false },
  default: { size: 'medium', constrainedLayout: false },
  wide: { size: 'large', constrainedLayout: false },
}

interface Props {
  node: SerializedInlineImageNode
  serialize: ({ nodes, options }: SerializeProps) => React.JSX.Element
  lng: Locale
  options: SerializeOptions
}

export function InlineImageSerializer({ node, serialize, lng, options }: Props): React.JSX.Element {
  const { showCaption, position, altText, document: pickerDoc, caption, link } = node
  const image = pickerDoc?.image as StoredFileValue | undefined

  const floatLeft = position === 'left'
  const floatRight = position === 'right'
  const isFloat = floatLeft || floatRight

  const { size, constrainedLayout } = POSITION_TO_SIZE[position ?? 'default']

  let classes: string
  if (floatLeft) {
    classes =
      'inline-image-block w-full sm:w-[50%] float-left mt-5 mb-5 sm:mt-[0.5rem] sm:mr-[1.2rem] sm:mb-1 sm:ml-0'
  } else if (floatRight) {
    classes =
      'inline-image-block w-full sm:w-[50%] float-right mt-5 mb-5 sm:mt-[0.5rem] sm:ml-[1rem] sm:mb-1 sm:mr-[1rem]'
  } else {
    classes = 'inline-image-block block w-full mt-5 mb-5'
  }

  // For now, if animation is disabled we must be inside a table cell
  // (or similar non-animatable host); also disable bleed-to-edge.
  const animationDisabled = options?.disableAnimation === true

  const Img = (
    <ResponsiveImage
      image={image}
      size={size}
      constrainedLayout={constrainedLayout}
      bleedOnMobile={!animationDisabled && !isFloat}
      alt={altText}
    />
  )

  const ImgSlot = animationDisabled ? (
    Img
  ) : (
    <FadeInLift as="span" delay={0.1} className="block">
      {Img}
    </FadeInLift>
  )

  // Optional click-through target.
  //
  // The anchor goes INSIDE the floated wrapper and wraps the image only.
  // Two reasons, both load-bearing:
  //
  //   - the float and the 50% column live on the outer span, so an anchor
  //     outside it would take the float and change the layout;
  //   - the caption is a nested editor that can contain its own links, and
  //     an `<a>` inside an `<a>` is invalid — browsers un-nest it and the
  //     layout breaks with it. The caption stays outside the anchor.
  //
  // `display: block` stops the inline `<a>` adding a descender gap beneath
  // the image. `getHref` returns '' for a target the walker marked
  // unresolved, in which case the image renders with no anchor at all —
  // the same degradation a text link gets.
  //
  // `options.insideLink` suppresses the anchor entirely: the image is
  // already inside a text link, whose anchor would be invalidated by a
  // nested one. The outer link wins.
  const href = options?.insideLink === true || link == null ? '' : getHref(link as LinkAttributes)

  // Target and rel are derived here rather than through the text link's
  // `getAdditionalProps`. That helper forces `target="_blank"` for any
  // external href regardless of the node's own `newTab`, which suits a text
  // link (they also get a visible external-link icon) but makes the image
  // dialog's "Open in new tab" checkbox a no-op for exactly the URLs an
  // editor is most likely to tick it for. Here the editor's choice is
  // authoritative.
  //
  // `rel="noopener"` is belt-and-braces, not a fix for a live hole: the
  // HTML standard has `target="_blank"` imply `noopener` unless a rel
  // explicitly opts back in, and conforming browsers have done so for
  // years. It is stated anyway so the guarantee does not rest on the
  // implied behaviour, and it matches what text links emit for `newTab`.
  // `noreferrer` is deliberately NOT added — it would additionally strip
  // the referrer, a separate behavioural choice that belongs with the
  // site's referrer policy rather than with this checkbox.
  const newTab = link?.newTab === true
  const anchorProps = newTab
    ? { target: '_blank', rel: 'noopener' }
    : ({} as { target?: string; rel?: string })

  const Linked =
    href.length === 0 ? (
      ImgSlot
    ) : href.startsWith('/') ? (
      <LangLink lng={lng} to={href} {...anchorProps} className="block">
        {ImgSlot}
      </LangLink>
    ) : (
      <a href={href} {...anchorProps} className="block">
        {ImgSlot}
      </a>
    )

  if (showCaption) {
    return (
      <span className={classes}>
        {Linked}
        <span className="block inline-image-block--caption">
          {caption?.editorState?.root?.children != null ? (
            // The caption is a nested serialize pass and can hold its own
            // links, so the surrounding options travel with it. Dropping
            // them would let a caption link emit an anchor inside the text
            // link this image sits in — the image's own anchor is already
            // suppressed for that reason, and the caption is no different.
            serialize({
              nodes: caption.editorState.root.children,
              lng,
              options: { ...options, renderParagraphInline: true },
            })
          ) : (
            <span>Caption not found for inline image.</span>
          )}
        </span>
      </span>
    )
  }

  return <span className={classes}>{Linked}</span>
}
