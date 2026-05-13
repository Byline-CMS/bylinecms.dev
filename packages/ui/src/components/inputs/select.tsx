'use client'

import type React from 'react'

import { Select as SelectPrimitive } from '@base-ui/react/select'
import cx from 'classnames'

import { CheckIcon } from '../../icons/check-icon.jsx'
import { ChevronDownIcon } from '../../icons/chevron-down-icon.jsx'
import { ChevronUpIcon } from '../../icons/chevron-up-icon.jsx'
import { Button } from '../button/button.jsx'
import { HelpText } from './help-text.jsx'
import styles from './select.module.css'
import type { Intent } from '../@types/shared.js'
import type { Size, Variant } from '../button/@types/button.js'

export interface SelectValue<Value extends string | number = string> {
  label: string
  value: Value
  prefix?: string
  suffix?: string
}

type SelectProps<Value extends string | number = string> = Omit<
  React.ComponentProps<typeof SelectPrimitive.Root<Value>>,
  'items'
> & {
  id?: string
  intent?: Intent
  variant?: Variant
  size?: Size
  placeholder?: string
  position?: 'item-aligned' | 'popper'
  containerClassName?: string
  className?: string
  disabledValue?: string
  ariaLabel?: string
  helpText?: string
  items?: SelectValue<Value>[]
}

export function Select<Value extends string | number = string>({
  id,
  children,
  placeholder,
  disabledValue,
  intent,
  variant,
  size,
  position,
  containerClassName,
  className,
  ariaLabel,
  helpText,
  items,
  ...rest
}: SelectProps<Value>): React.JSX.Element {
  return (
    <div className={cx('byline-select-container', containerClassName)}>
      <SelectPrimitive.Root<Value> items={items} {...rest}>
        <SelectPrimitive.Trigger
          aria-label={ariaLabel ?? 'Select'}
          render={
            <Button
              id={id}
              intent={intent}
              variant={variant}
              size={size}
              className={cx('whitespace-nowrap', className)}
            />
          }
        >
          <SelectPrimitive.Value placeholder={placeholder} />
          <SelectPrimitive.Icon>
            <ChevronDownIcon />
          </SelectPrimitive.Icon>
        </SelectPrimitive.Trigger>

        <SelectPrimitive.Portal>
          <SelectPrimitive.Positioner
            className={styles.positioner}
            alignItemWithTrigger={position !== 'popper'}
          >
            <SelectPrimitive.ScrollUpArrow className={styles['scroll-arrow']}>
              <ChevronUpIcon />
            </SelectPrimitive.ScrollUpArrow>
            <SelectPrimitive.Popup
              className={cx(styles.popup, size != null && styles[`popup-${size}`])}
            >
              <SelectPrimitive.List className={styles.list}>
                {children ??
                  items?.map((item) => (
                    <SelectItem key={item.value} value={item.value} label={item.label}>
                      {item.label}
                    </SelectItem>
                  ))}
              </SelectPrimitive.List>
            </SelectPrimitive.Popup>
            <SelectPrimitive.ScrollDownArrow className={styles['scroll-arrow']}>
              <ChevronDownIcon />
            </SelectPrimitive.ScrollDownArrow>
          </SelectPrimitive.Positioner>
        </SelectPrimitive.Portal>
      </SelectPrimitive.Root>
      {helpText != null && helpText?.length > 0 && <HelpText text={helpText} />}
    </div>
  )
}

export const SelectItem = ({
  ref: forwardedRef,
  children,
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Item> & {
  ref?: React.RefObject<HTMLDivElement>
}) => {
  return (
    <SelectPrimitive.Item
      className={cx('byline-select-item', styles['select-item'], className)}
      {...props}
      ref={forwardedRef}
    >
      <SelectPrimitive.ItemIndicator
        className={cx('byline-select-item-indicator', styles['select-item-indicator'])}
      >
        <CheckIcon />
      </SelectPrimitive.ItemIndicator>
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
    </SelectPrimitive.Item>
  )
}

SelectItem.displayName = 'SelectItem'
