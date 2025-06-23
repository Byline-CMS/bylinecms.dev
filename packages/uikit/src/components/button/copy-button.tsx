'use client'
import type React from 'react'
import { useEffect, useState } from 'react'

import cx from 'classnames'

import { CopyIcon } from '../../icons'
import { Tooltip } from '../tooltip/tooltip.js'
import { Button } from './button.js'

import type { ButtonProps } from './button.js'

import styles from './copy-button.module.css'

interface CopyButtonProps extends Omit<ButtonProps, 'children'> {
  text: string
  hoverText?: string
  copiedText?: string
  containerClassName?: string
  svgClassName?: string
}

export function CopyButton({
  text,
  hoverText = 'Copy',
  copiedText = 'Copied!',
  variant,
  size = 'sm',
  intent,
  fullWidth,
  ripple,
  className,
  containerClassName,
  svgClassName,
  ...rest
}: CopyButtonProps): React.JSX.Element {
  const [copied, setCopied] = useState<boolean | undefined>(undefined)

  const handleCopied = (): void => {
    // TODO: Permissions check?
    if (navigator.clipboard != null && navigator.permissions != null) {
      void navigator.clipboard.writeText(text).then(() => {
        setCopied(true)
      })
    } else if (document.queryCommandSupported('copy')) {
      const element = document.createElement('textarea')
      element.value = text
      document.body.appendChild(element)
      element.select()
      document.execCommand('copy')
      document.body.removeChild(element)
      setCopied(true)
    }
  }

  useEffect(() => {
    if (copied === true) {
      setTimeout(() => {
        setCopied(undefined)
      }, 900)
    }
  })

  const svgColor =
    intent === 'noeffect' ||
    intent === 'secondary' ||
    intent === 'warning' ||
    variant === 'outlined' ||
    variant === 'text'
      ? styles['copy-button-foreground']
      : styles['copy-button-foreground-reversed']

  const tooltipText = copied != null && copied ? copiedText : hoverText

  return (
    <div className={cx(styles['copy-button-container'], containerClassName)}>
      <Tooltip side="top" sideOffset={2} text={tooltipText} open={copied}>
        <Button
          variant={variant}
          size={size}
          intent={intent}
          fullWidth={fullWidth}
          ripple={ripple}
          className={cx(styles['copy-button'], className)}
          onClick={handleCopied}
          {...rest}
        >
          <CopyIcon svgClassName={cx(svgColor, svgClassName)} width="18px" height="18px" />
        </Button>
      </Tooltip>
    </div>
  )
}
