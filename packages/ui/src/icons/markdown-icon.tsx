import type React from 'react'

import cx from 'classnames'

import { IconElement } from './icon-element.js'
import styles from './icons.module.css'
import type { IconProps } from './types/icon.js'

/**
 * The CommonMark mark — the conventional glyph for "this content is available
 * as markdown". Used by surfaces that expose a document's `.md` representation.
 */
export const MarkdownIcon = ({
  className,
  svgClassName,
  ...rest
}: IconProps): React.JSX.Element => {
  const applied = cx(styles['fill-current'], svgClassName)

  return (
    <IconElement className={cx('markdown-icon', className)} {...rest}>
      <svg
        className={applied}
        xmlns="http://www.w3.org/2000/svg"
        focusable="false"
        aria-hidden="true"
        viewBox="0 0 16 16"
        strokeWidth="0"
      >
        <path
          d="M14.5 3H1.5C0.671573 3 0 3.67157 0 4.5V11.5C0 12.3284 0.671573 13 1.5 13H14.5C15.3284 13 16 12.3284 16 11.5V4.5C16 3.67157 15.3284 3 14.5 3ZM1.5 4H14.5C14.7761 4 15 4.22386 15 4.5V11.5C15 11.7761 14.7761 12 14.5 12H1.5C1.22386 12 1 11.7761 1 11.5V4.5C1 4.22386 1.22386 4 1.5 4Z"
          fillRule="evenodd"
          clipRule="evenodd"
        />
        <path d="M2.5 10.5V5.5H4L5.5 7.5L7 5.5H8.5V10.5H7V7.75L5.5 9.75L4 7.75V10.5H2.5Z" />
        <path d="M11.75 10.5L9.5 8H11V5.5H12.5V8H14L11.75 10.5Z" />
      </svg>
    </IconElement>
  )
}

MarkdownIcon.displayName = 'MarkdownIcon'
