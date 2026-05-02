'use client'

import { useState } from 'react'

import cx from 'classnames'

import { getVariant, getWebpVariantSrcSet } from '@/ui/utils/image-sources.ts'
import type { PhotoProps } from './@types/index.ts'

export const PhotoComponent = ({
  photo,
  constrainedLayout,
  bleedOnMobile = true,
  alt,
  className,
  size = 'auto',
  imgClassName,
  onClick,
  onLoad: onLoadFromProps,
}: PhotoProps): React.JSX.Element | null => {
  const [_isLoading, setIsLoading] = useState(true)

  const image = photo?.image
  if (image?.storageUrl == null) return null

  const resolvedAlt = alt ?? photo.altText ?? ''

  // Bleed-to-edge classes that apply at mobile width.
  // TODO: very hacky. Refactor into a better approach to options for
  // photo component and serialization.
  let imageClasses = 'not-prose sm:w-full'
  if (bleedOnMobile === true) {
    imageClasses +=
      ' -ml-[18px] -mr-[18px] max-w-[calc(100%+36px)] sm:ml-auto sm:mr-auto sm:max-w-full'
  } else {
    imageClasses += ' ml-auto mr-auto max-w-full'
  }

  const handleLoad = (): void => {
    setIsLoading(false)
    if (typeof onLoadFromProps === 'function') {
      onLoadFromProps()
    }
  }

  // SVG bypass — variants are not generated for SVG; render the original.
  if (image.mimeType === 'image/svg+xml') {
    return (
      <img
        className={cx(imageClasses, imgClassName, className)}
        src={image.storageUrl}
        alt={resolvedAlt}
        onClick={onClick}
        onKeyDown={onClick}
        onLoad={handleLoad}
        width={image.imageWidth ?? undefined}
        height={image.imageHeight ?? undefined}
      />
    )
  }

  const webpSrcSet = getWebpVariantSrcSet(photo, size)
  const reducedViewport = (constrainedLayout ?? false) ? '50vw' : '100vw'

  // Prefer the smallest variant as the `<img>` fallback `src` so layout
  // can settle before a larger variant from the srcSet wins. Falls back
  // to the original if no thumbnail variant is available.
  const fallbackSrc = getVariant(photo, 'thumbnail')?.storageUrl ?? image.storageUrl

  return (
    <picture className={cx('not-prose', className)}>
      {webpSrcSet.length > 0 && (
        <source
          srcSet={webpSrcSet.join(', ')}
          type="image/webp"
          sizes={`(min-width: 768px) ${reducedViewport}, 100vw`}
        />
      )}
      <img
        className={cx(imageClasses, imgClassName)}
        src={fallbackSrc}
        alt={resolvedAlt}
        onClick={onClick}
        onKeyDown={onClick}
        onLoad={handleLoad}
        width={image.imageWidth ?? undefined}
        height={image.imageHeight ?? undefined}
      />
    </picture>
  )
}
