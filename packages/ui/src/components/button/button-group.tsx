'use client'

import React, { type Ref } from 'react'

import { Toggle } from '@base-ui/react/toggle'
import { ToggleGroup } from '@base-ui/react/toggle-group'
import cx from 'classnames'

import { Button } from './button'
import styles from './button-group.module.css'
import type { EnableRipple, Intent, Size, Variant } from './@types/button'

interface ButtonGroupContextType {
  variant?: Variant
  size?: Size
  ripple?: EnableRipple
  expandToFit?: boolean
  active?: Intent
  inactive?: Intent
  value?: string | string[]
}

const ButtonGroupContext = React.createContext<ButtonGroupContextType>({
  size: 'md',
  variant: 'filled',
  ripple: true,
  expandToFit: false,
  active: 'primary',
  inactive: 'noeffect',
})

type ToggleGroupProps = React.ComponentProps<typeof ToggleGroup>

// Create separate props for single and multiple modes
type SingleToggleGroupProps = Omit<ToggleGroupProps, 'multiple' | 'value' | 'onValueChange'> & {
  type: 'single'
  value?: string
  onValueChange?: (value: string) => void
}

type MultipleToggleGroupProps = Omit<ToggleGroupProps, 'multiple' | 'value' | 'onValueChange'> & {
  type: 'multiple'
  value?: string[]
  onValueChange?: (value: string[]) => void
}

export type ButtonGroupProps = (SingleToggleGroupProps | MultipleToggleGroupProps) & {
  onValueChange?: (value: string | string[]) => void
  ref?: Ref<HTMLDivElement>
} & ButtonGroupContextType

// Updated to use ref as a prop and not React.forwardRef
const ButtonGroup = ({
  className,
  variant = 'filled',
  size = 'md',
  ripple = true,
  expandToFit = false,
  active = 'primary',
  inactive = 'noeffect',
  type,
  onValueChange,
  value,
  defaultValue,
  children,
  ref,
  ...props
}: ButtonGroupProps) => {
  const isMultiple = type === 'multiple'

  const handleValueChange: React.ComponentProps<typeof ToggleGroup>['onValueChange'] = (
    newValue,
    _event
  ) => {
    if (!onValueChange) return
    if (isMultiple) {
      onValueChange(newValue)
    } else {
      // For single mode, pass the first value or empty string
      onValueChange(newValue[0] ?? '')
    }
  }

  // Normalize value to string[] for Base UI
  const normalizedValue = value == null ? undefined : Array.isArray(value) ? value : [value]
  const normalizedDefault =
    defaultValue == null ? undefined : Array.isArray(defaultValue) ? defaultValue : [defaultValue]

  return (
    <ToggleGroup
      multiple={isMultiple}
      defaultValue={normalizedDefault}
      value={normalizedValue}
      ref={ref}
      onValueChange={handleValueChange}
      className={cx(styles['button-group'], className)}
      {...props}
    >
      <ButtonGroupContext value={{ variant, size, ripple, expandToFit, active, inactive, value }}>
        {children}
      </ButtonGroupContext>
    </ToggleGroup>
  )
}

ButtonGroupContext.displayName = 'ButtonGroup'

type ButtonGroupItemProps = Omit<React.ComponentProps<typeof Toggle>, 'className'> & {
  className?: string
  ref?: Ref<HTMLButtonElement>
} & ButtonGroupContextType

const ButtonGroupItem = ({ className, children, value, ref, ...props }: ButtonGroupItemProps) => {
  const context = React.useContext(ButtonGroupContext)
  const active = Array.isArray(context.value)
    ? context.value.includes(value!)
    : context.value === value

  return (
    <Toggle
      value={value}
      ref={ref}
      render={
        <Button
          className={className}
          fullWidth={context.expandToFit}
          variant={context.variant}
          intent={active ? context.active : context.inactive}
          size={context.size}
          ripple={context.ripple}
        />
      }
      {...props}
    >
      {children}
    </Toggle>
  )
}

ButtonGroupItem.displayName = 'ButtonGroupItem'

export { ButtonGroup, ButtonGroupItem }
