'use client'

import type React from 'react'

import { FadeInLift } from '@infonomic/uikit/react'

import { PhotoComponent } from '../photo/index.tsx'
import type { Locale } from '@/i18n/i18n-config.ts'
import type { SerializeOptions, SerializeProps } from '../richtext-lexical/serialize/index.tsx'
import type { SerializedLexicalNode } from '../richtext-lexical/serialize/types.ts'

export function InlineImageSerializer({
  node,
  serialize,
  lng,
  options,
}: {
  node: SerializedLexicalNode
  serialize: ({ nodes, options }: SerializeProps) => React.JSX.Element
  lng: Locale
  options: SerializeOptions
}): React.JSX.Element {
  const showCaption = node?.showCaption != null && node.showCaption === true
  const isFloat = node?.position === 'left' || node?.position === 'right'
  const floatLeft = node?.position === 'left'
  const floatRight = node?.position === 'right'
  const _size = node?.size ?? 'auto'

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

  if (showCaption) {
    return (
      <span className={classes}>
        {options != null && options.disableAnimation === true ? (
          <PhotoComponent
            constrainedLayout={isFloat} // For now if we've disabled animation we must be in a table cell, so disable
            // bleed to edge on mobile
            bleedOnMobile={options.disableAnimation !== true}
            photo={node?.doc?.data}
            alt={node.altText}
          />
        ) : (
          <FadeInLift as="span" delay={0.1} className="block">
            <PhotoComponent
              constrainedLayout={isFloat}
              // For now if we've disabled animation we must be in a table cell, so disable
              // bleed to edge on mobile
              bleedOnMobile={options.disableAnimation !== true}
              photo={node?.doc?.data}
              alt={node.altText}
            />
          </FadeInLift>
        )}

        <span className="block inline-image-block--caption">
          {node?.caption?.editorState?.root?.children != null ? (
            serialize({
              nodes: node?.caption?.editorState?.root?.children,
              lng,
              options: { renderParagraphInline: true },
            })
          ) : (
            <span>Caption not found for inline image.</span>
          )}
        </span>
      </span>
    )
  } else {
    return (
      <span className={classes}>
        {options != null && options.disableAnimation === true ? (
          <PhotoComponent
            constrainedLayout={isFloat} // For now if we've disabled animation we must be in a table cell, so disable
            // bleed to edge on mobile
            bleedOnMobile={options.disableAnimation !== true}
            photo={node?.doc?.data}
            alt={node.altText}
          />
        ) : (
          <FadeInLift as="span" delay={0.1} className="block">
            <PhotoComponent
              constrainedLayout={isFloat}
              // For now if we've disabled animation we must be in a table cell, so disable
              // bleed to edge on mobile
              bleedOnMobile={options.disableAnimation !== true}
              photo={node?.doc?.data}
              alt={node.altText}
            />
          </FadeInLift>
        )}
      </span>
    )
  }
}
