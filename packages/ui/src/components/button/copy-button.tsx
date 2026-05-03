'use client'

import type React from 'react'
import { useEffect, useState } from 'react'

import cx from 'classnames'

import { Tooltip } from '../tooltip/tooltip.js'
import { Button } from './button.js'
import styles from './copy-button.module.css'
import type { ButtonProps } from './button.js'

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
  // Track copied-feedback and hover-open as separate booleans so the
  // tooltip's `open` prop is always a boolean. Passing `undefined` -> `true`
  // makes Base UI's Tooltip switch from uncontrolled to controlled and emits
  // a React warning in consumer apps.
  const [copied, setCopied] = useState(false)
  const [hoverOpen, setHoverOpen] = useState(false)

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
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), 900)
    return () => clearTimeout(timer)
  }, [copied])

  const tooltipText = copied ? copiedText : hoverText

  return (
    <div
      className={cx(
        'infonomic-copy-button-container',
        styles['copy-button-container'],
        containerClassName
      )}
    >
      <Tooltip
        side="top"
        sideOffset={2}
        text={tooltipText}
        open={copied || hoverOpen}
        onOpenChange={(next) => {
          // While the "Copied!" feedback is showing, ignore hover-close so
          // the tooltip stays visible for the full confirmation window.
          if (copied && !next) return
          setHoverOpen(next)
        }}
      >
        <Button
          variant={variant}
          size={size}
          intent={intent}
          fullWidth={fullWidth}
          ripple={ripple}
          className={cx(
            'infonomic-copy-button',
            `infonomic-copy-button-${variant}`,
            `infonomic-copy-button-${size}`,
            `infonomic-copy-button-${intent}`,
            styles[size],
            className
          )}
          onClick={handleCopied}
          {...rest}
        >
          <svg
            className={svgClassName}
            xmlns="http://www.w3.org/2000/svg"
            focusable="false"
            aria-hidden="true"
            viewBox="0 0 15 15"
            strokeWidth="0"
          >
            <path
              d="M1 9.50006C1 10.3285 1.67157 11.0001 2.5 11.0001H4L4 10.0001H2.5C2.22386 10.0001 2 9.7762 2 9.50006L2 2.50006C2 2.22392 2.22386 2.00006 2.5 2.00006L9.5 2.00006C9.77614 2.00006 10 2.22392 10 2.50006V4.00002H5.5C4.67158 4.00002 4 4.67159 4 5.50002V12.5C4 13.3284 4.67158 14 5.5 14H12.5C13.3284 14 14 13.3284 14 12.5V5.50002C14 4.67159 13.3284 4.00002 12.5 4.00002H11V2.50006C11 1.67163 10.3284 1.00006 9.5 1.00006H2.5C1.67157 1.00006 1 1.67163 1 2.50006V9.50006ZM5 5.50002C5 5.22388 5.22386 5.00002 5.5 5.00002H12.5C12.7761 5.00002 13 5.22388 13 5.50002V12.5C13 12.7762 12.7761 13 12.5 13H5.5C5.22386 13 5 12.7762 5 12.5V5.50002Z"
              fill="currentColor"
              fillRule="evenodd"
              clipRule="evenodd"
            />
          </svg>
        </Button>
      </Tooltip>
    </div>
  )
}
