'use client'

import type React from 'react'

import { Tooltip as TooltipPrimitive } from '@base-ui/react/tooltip'
import cx from 'classnames'

import styles from './tooltip.module.css'

export interface TooltipProps {
  text: string
  delay?: number
  side?: 'bottom' | 'top' | 'right' | 'left'
  sideOffset?: number
  disableHoverablePopup?: boolean
  open?: boolean
  onOpenChange?: (open: boolean) => void
  children: React.ReactElement
  ref?: React.RefObject<HTMLDivElement>
}

function ArrowSvg(props: React.ComponentProps<'svg'>) {
  return (
    <svg
      width="15"
      height="8"
      viewBox="0 0 20 10"
      fill="none"
      aria-hidden
      role="presentation"
      {...props}
    >
      <path
        d="M9.66437 2.60207L4.80758 6.97318C4.07308 7.63423 3.11989 8 2.13172 8H0V10H20V8H18.5349C17.5468 8 16.5936 7.63423 15.8591 6.97318L11.0023 2.60207C10.622 2.2598 10.0447 2.25979 9.66437 2.60207Z"
        className={styles['arrow-fill']}
      />
      <path
        d="M8.99542 1.85876C9.75604 1.17425 10.9106 1.17422 11.6713 1.85878L16.5281 6.22989C17.0789 6.72568 17.7938 7.00001 18.5349 7.00001L15.89 7L11.0023 2.60207C10.622 2.2598 10.0447 2.2598 9.66436 2.60207L4.77734 7L2.13171 7.00001C2.87284 7.00001 3.58774 6.72568 4.13861 6.22989L8.99542 1.85876Z"
        className={styles['arrow-outer-stroke']}
      />
      <path
        d="M10.3333 3.34539L5.47654 7.71648C4.55842 8.54279 3.36693 9 2.13172 9H0V8H2.13172C3.11989 8 4.07308 7.63423 4.80758 6.97318L9.66437 2.60207C10.0447 2.25979 10.622 2.2598 11.0023 2.60207L15.8591 6.97318C16.5936 7.63423 17.5468 8 18.5349 8H20V9H18.5349C17.2998 9 16.1083 8.54278 15.1901 7.71648L10.3333 3.34539Z"
        className={styles['arrow-inner-stroke']}
      />
    </svg>
  )
}

export const Tooltip = function Tooltip({
  ref,
  text,
  delay = 500,
  side = 'top',
  sideOffset = 10,
  disableHoverablePopup,
  open,
  onOpenChange,
  children,
}: TooltipProps): React.JSX.Element {
  return (
    <TooltipPrimitive.Provider delay={delay}>
      <TooltipPrimitive.Root
        open={open}
        onOpenChange={onOpenChange}
        disableHoverablePopup={disableHoverablePopup}
      >
        <TooltipPrimitive.Trigger render={children} />
        <TooltipPrimitive.Portal>
          <TooltipPrimitive.Positioner ref={ref} side={side} sideOffset={sideOffset}>
            <TooltipPrimitive.Popup className={cx(styles.tooltip, 'byline-tooltip')}>
              <TooltipPrimitive.Arrow
                className={cx(styles['tooltip-arrow'], 'byline-tooltip-arrow')}
              >
                <ArrowSvg />
              </TooltipPrimitive.Arrow>
              {text}
            </TooltipPrimitive.Popup>
          </TooltipPrimitive.Positioner>
        </TooltipPrimitive.Portal>
      </TooltipPrimitive.Root>
    </TooltipPrimitive.Provider>
  )
}
