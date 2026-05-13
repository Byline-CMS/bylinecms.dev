'use client'

import type React from 'react'

import { Avatar as AvatarPrimitive } from '@base-ui/react/avatar'
import cx from 'classnames'

import styles from './avatar.module.css'

const url = 'https://picsum.photos/150'

export const Avatar = ({ initials }: { initials: string }): React.JSX.Element => {
  return (
    <AvatarPrimitive.Root className={cx('byline-avatar-root', styles['avatar-root'])}>
      <AvatarPrimitive.Image
        src={url}
        alt="Avatar"
        className={cx('byline-avatar-image', styles['avatar-image'])}
      />
      <AvatarPrimitive.Fallback
        className={cx('byline-avatar-fallback', styles['avatar-fallback'])}
        delay={600}
      >
        <span className={cx('byline-avatar-text', styles['avatar-text'])}>{initials}</span>
      </AvatarPrimitive.Fallback>
    </AvatarPrimitive.Root>
  )
}
