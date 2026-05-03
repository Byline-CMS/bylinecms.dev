'use client'

import type React from 'react'

import type { StoredFileValue } from '@byline/core'
import type { InlineImagePosition, SerializedInlineImageNode } from '@byline/richtext-lexical'
import { FadeInLift } from '@infonomic/uikit/react'

import { ResponsiveImage } from '../responsive-image/index.tsx'
import type { Locale } from '@/i18n/i18n-config.ts'
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
  const { showCaption, position, altText, document: pickerDoc, caption } = node
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

  if (showCaption) {
    return (
      <span className={classes}>
        {ImgSlot}
        <span className="block inline-image-block--caption">
          {caption?.editorState?.root?.children != null ? (
            serialize({
              nodes: caption.editorState.root.children,
              lng,
              options: { renderParagraphInline: true },
            })
          ) : (
            <span>Caption not found for inline image.</span>
          )}
        </span>
      </span>
    )
  }

  return <span className={classes}>{ImgSlot}</span>
}
