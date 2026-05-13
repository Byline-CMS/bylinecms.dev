'use client'

import type React from 'react'

import { mergeProps } from '@base-ui/react/merge-props'
import { useRender } from '@base-ui/react/use-render'
import cx from 'classnames'

import { CheckIcon } from '../../icons/check-icon.js'
import { CloseIcon } from '../../icons/close-icon.js'
import styles from './chip.module.css'
import type { ChipIntent, ChipSize, ChipVariant } from './@types/chip.js'

type ToggleEvent = React.MouseEvent<HTMLElement> | React.KeyboardEvent<HTMLElement>
type RemoveEvent = React.MouseEvent<HTMLElement> | React.KeyboardEvent<HTMLElement>

export type ChipProps = Omit<useRender.ComponentProps<'button'>, 'onToggle'> & {
  variant?: ChipVariant
  intent?: ChipIntent
  size?: ChipSize
  selected?: boolean
  disabled?: boolean
  startIcon?: React.ReactNode
  endIcon?: React.ReactNode
  selectedIcon?: React.ReactNode
  removeLabel?: string
  onToggle?: (selected: boolean, event: ToggleEvent) => void
  onRemove?: (event: RemoveEvent) => void
  className?: string
  ref?: React.Ref<HTMLButtonElement>
} & Omit<React.HTMLAttributes<HTMLElement>, 'onToggle'>

export const Chip = ({
  variant = 'assist',
  intent = 'primary',
  size = 'md',
  selected = false,
  disabled = false,
  startIcon,
  endIcon,
  selectedIcon,
  removeLabel = 'Remove chip',
  onToggle,
  onRemove,
  className,
  children,
  render,
  ref,
  ...rest
}: ChipProps) => {
  const { onClick, onKeyDown, role, tabIndex, ...restProps } = rest
  const isCustomElement = render != null
  const isSelectable = variant === 'selectable' || variant === 'selectable-removable'
  const isRemovable = variant === 'removable' || variant === 'selectable-removable'
  const isSelected = Boolean(selected)

  const handleClick = (event: React.MouseEvent<HTMLElement>) => {
    if (disabled) {
      event.preventDefault()
      return
    }

    if (onClick) {
      ;(onClick as React.MouseEventHandler<HTMLElement>)(event)
    }

    if (isSelectable && onToggle) {
      onToggle(!isSelected, event)
    }
  }

  const handleKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    if (disabled) {
      return
    }

    if ((event.key === 'Enter' || event.key === ' ') && isCustomElement) {
      event.preventDefault()
      if (onClick) {
        ;(onClick as React.MouseEventHandler<HTMLElement>)(
          event as unknown as React.MouseEvent<HTMLElement>
        )
      }
      if (isSelectable && onToggle) {
        onToggle(!isSelected, event)
      }
    }

    if ((event.key === 'Backspace' || event.key === 'Delete') && isRemovable && onRemove) {
      event.preventDefault()
      onRemove(event)
    }

    if (onKeyDown) {
      onKeyDown(event)
    }
  }

  const handleRemoveClick = (event: React.MouseEvent<HTMLElement>) => {
    if (disabled) {
      return
    }
    event.stopPropagation()
    if (onRemove) {
      onRemove(event)
    }
  }

  const handleRemoveKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    if (disabled) {
      return
    }

    if (
      event.key === 'Enter' ||
      event.key === ' ' ||
      event.key === 'Backspace' ||
      event.key === 'Delete'
    ) {
      event.preventDefault()
      event.stopPropagation()
      if (onRemove) {
        onRemove(event)
      }
    }
  }

  const leadingIcon =
    startIcon ??
    (isSelectable && isSelected ? (selectedIcon ?? <CheckIcon className={styles.icon} />) : null)

  const trailingIcon = isRemovable ? (
    <button
      type="button"
      tabIndex={disabled ? -1 : 0}
      disabled={disabled}
      aria-label={removeLabel}
      onClick={handleRemoveClick}
      onKeyDown={handleRemoveKeyDown}
    >
      <CloseIcon className={cx('byline-chip-close-icon', styles.icon, styles['close-icon'])} />
    </button>
  ) : (
    endIcon
  )

  const appliedVariant = isSelected ? 'filled' : 'outlined'

  const defaultProps: Record<string, unknown> = {
    type: isCustomElement ? undefined : 'button',
    role: role ?? (isCustomElement ? 'button' : undefined),
    tabIndex: disabled ? -1 : (tabIndex ?? 0),
    'aria-disabled': disabled || undefined,
    'aria-pressed': isSelectable ? isSelected : undefined,
    'aria-selected': isSelectable ? isSelected : undefined,
    className: cx(
      'byline-chip',
      `byline-chip-${variant}`,
      `byline-chip-${intent}`,
      `byline-chip-${size}`,
      { selected: isSelected, disabled, removable: isRemovable },
      styles.chip,
      styles[appliedVariant],
      styles[intent],
      styles[size],
      className
    ),
    disabled: isCustomElement ? undefined : disabled,
    onClick: handleClick,
    onKeyDown: handleKeyDown,
    children: (
      <>
        {leadingIcon != null && (
          <span className={cx('byline-chip-icon-wrapper', styles.iconWrapper)}>{leadingIcon}</span>
        )}
        <span className={cx('byline-chip-label', styles.label)}>{children}</span>
        {trailingIcon != null && (
          <span className={cx('byline-chip-icon-wrapper', styles.iconWrapper)}>{trailingIcon}</span>
        )}
      </>
    ),
  }

  const element = useRender({
    defaultTagName: 'button',
    render,
    ref,
    props: mergeProps<'button'>(defaultProps, restProps),
  })

  return element
}

Chip.displayName = 'Chip'
