import cx from 'classnames'

import { ChevronDownIcon } from '../../icons/chevron-down-icon'
import { Dropdown as DropdownComponent } from '../dropdown/dropdown'
import { Button, type ButtonProps } from './button'
import styles from './combo-button.module.css'

export type ComboButtonProps = ButtonProps & {
  options: { label: string; value: string }[]
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
  return (
    <div
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
                    {option.label}
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
