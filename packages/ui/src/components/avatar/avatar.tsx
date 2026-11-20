'use client'

import type React from 'react'

import { Avatar as AvatarPrimitive } from '@base-ui/react/avatar'
import cx from 'clsx'

import styles from './avatar.module.css'

export interface AvatarProps {
  /** Shown when there is no `src`, or while the image loads or if it fails. */
  initials: string
  /** Image URL. When omitted, no request is made and the initials show at once. */
  src?: string
  /** Text alternative for the image. Defaults to `initials`. */
  alt?: string
}

export const Avatar = ({ initials, src, alt = initials }: AvatarProps): React.JSX.Element => {
  return (
    <AvatarPrimitive.Root className={cx('byline-avatar-root', styles['avatar-root'])}>
      {src ? (
        <AvatarPrimitive.Image
          src={src}
          alt={alt}
          className={cx('byline-avatar-image', styles['avatar-image'])}
        />
      ) : null}
      <AvatarPrimitive.Fallback
        className={cx('byline-avatar-fallback', styles['avatar-fallback'])}
        delay={src ? 600 : 0}
      >
        <span className={cx('byline-avatar-text', styles['avatar-text'])}>{initials}</span>
      </AvatarPrimitive.Fallback>
    </AvatarPrimitive.Root>
  )
}
