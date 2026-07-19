import { useRef } from 'react'

import cx from 'classnames'

import { ChevronDownIcon } from '../../icons/chevron-down-icon'
import { Dropdown as DropdownComponent } from '../dropdown/dropdown'
import { Button, type ButtonProps } from './button'
import styles from './combo-button.module.css'

export interface ComboButtonOption {
  label: string
  value: string
  /**
   * Optional leading icon for the menu item. Rendered before the label; items
   * without one still align with their icon-bearing siblings, so a menu may
   * mix the two.
   */
  icon?: React.ReactNode
}

export type ComboButtonProps = ButtonProps & {
  options: ComboButtonOption[]
  onButtonClick?: () => void
  onOptionSelect?: (value: string) => void
  disabled?: boolean
  buttonDisabled?: boolean
  optionsDisabled?: boolean
  children?: React.ReactNode
  align?: 'start' | 'center' | 'end'
  dataSide?: 'top' | 'bottom' | 'left' | 'right'
  sideOffset?: number
  className?: string
  buttonClassName?: string
  triggerClassName?: string
}

export const ComboButton = ({
  options,
  onButtonClick,
  onOptionSelect,
  disabled = false,
  buttonDisabled = false,
  optionsDisabled = false,
  children,
  align = 'end',
  dataSide = 'top',
  sideOffset = 5,
  className,
  buttonClassName,
  triggerClassName,
  intent = 'primary',
  ...rest
}: ComboButtonProps) => {
  // Reserve the icon column for every item as soon as one option carries an
  // icon, so labels stay on a common left edge in a mixed menu.
  const anyOptionHasIcon = options.some((option) => option.icon != null)

  // The menu is positioned against the whole control, not against the dropdown
  // half that triggers it. Anchoring to the trigger would measure `align`
  // from the narrow chevron, so an `end`-aligned menu hangs off the right of
  // the button and a `start`-aligned one starts at the chevron rather than at
  // the button's left edge.
  const wrapperRef = useRef<HTMLDivElement>(null)

  return (
    <div
      ref={wrapperRef}
      className={cx('combo-button-wrapper', styles['combo-button-wrapper'], className)}
      style={{ '--ring-color': `var(--ring-${intent})` } as React.CSSProperties}
    >
      <Button
        className={cx('combo-button-button', styles['combo-button-button'], buttonClassName)}
        disabled={disabled || buttonDisabled}
        intent={intent}
        {...rest}
        onClick={onButtonClick}
      >
        {children}
      </Button>
      <DropdownComponent.Root>
        <DropdownComponent.Trigger
          className={cx('combo-button-trigger', styles['combo-button-trigger'], triggerClassName)}
          render={<Button disabled={disabled || optionsDisabled} intent={intent} {...rest} />}
        >
          <ChevronDownIcon width="16px" height="16px" />
        </DropdownComponent.Trigger>

        {options.length > 0 && (
          <DropdownComponent.Portal>
            <DropdownComponent.Content
              className={cx('combo-button-options', styles['combo-button-options'])}
              align={align}
              anchor={wrapperRef}
              data-side={dataSide}
              sideOffset={sideOffset}
            >
              {options.map((option) => (
                <DropdownComponent.Item
                  key={option.value}
                  onClick={() => onOptionSelect?.(option.value)}
                >
                  <div
                    className={cx('combo-button-options-item', styles['combo-button-options-item'])}
                  >
                    {anyOptionHasIcon && (
                      <span
                        className={cx(
                          'combo-button-options-item-icon',
                          styles['combo-button-options-item-icon']
                        )}
                        aria-hidden="true"
                      >
                        {option.icon}
                      </span>
                    )}
                    <span
                      className={cx(
                        'combo-button-options-item-label',
                        styles['combo-button-options-item-label']
                      )}
                    >
                      {option.label}
                    </span>
                  </div>
                </DropdownComponent.Item>
              ))}
            </DropdownComponent.Content>
          </DropdownComponent.Portal>
        )}
      </DropdownComponent.Root>
    </div>
  )
}
