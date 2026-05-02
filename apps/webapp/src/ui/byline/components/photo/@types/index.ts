import type { Ref } from 'react'

import type { MediaFields } from '~/collections/media/schema'

export interface PhotoProps {
  /** Populated Media document — pass via `populate: { photo: '*' }`. */
  photo: MediaFields
  constrainedLayout?: boolean
  position?: 'default' | 'wide' | 'full_width' | null
  size?: 'auto' | 'small' | 'medium'
  bleedOnMobile?: boolean
  caption?: string
  htmlElement?: string
  alt?: string
  className?: string
  imgClassName?: string
  onClick?: () => void
  onLoad?: () => void
  ref?: Ref<null | HTMLImageElement>
}
