'use client'

import type * as React from 'react'

import { Checkbox as CheckboxPrimitive } from '@base-ui/react/checkbox'
import cx from 'classnames'

import { CheckIcon } from '../../icons/check-icon'
import styles from './checkbox.module.css'
import { ErrorText } from './error-text.jsx'
import { HelpText } from './help-text.jsx'
import type { Intent, Size, Variant } from './@types/checkbox.js'

export interface CheckboxProps {
  id: string
  name: string
  label?: string
  variant?: Variant
  size?: Size
  intent?: Intent
  reverse?: boolean
  checked?: boolean
  disabled?: boolean
  className?: string
  checkBoxClasses?: string
  containerClasses?: string
  componentClasses?: string
  labelClasses?: string
  error?: boolean
  helpText?: string
  errorText?: string
  onCheckedChange?: React.ComponentProps<typeof CheckboxPrimitive.Root>['onCheckedChange']
  onClick?: React.MouseEventHandler
  'aria-label'?: string
}

export const Checkbox = function Checkbox({
  ref,
  id,
  name,
  label,
  variant = 'outlined',
  size = 'md',
  intent = 'primary',
  reverse = false,
  className,
  checkBoxClasses,
  containerClasses,
  componentClasses,
  labelClasses,
  error = false,
  helpText = '',
  errorText = '',
  ...rest
}: CheckboxProps & {
  ref?: React.RefObject<HTMLButtonElement>
}): React.JSX.Element {
  return (
    <div className={cx('infonomic-checkbox-container', styles.container, containerClasses)}>
      <div
        className={cx('infonomic-checkbox-component', styles.component, componentClasses, {
          [styles.reverse]: reverse,
        })}
      >
        <CheckboxPrimitive.Root
          ref={ref}
          id={id}
          name={name}
          nativeButton
          render={<button type="button" />}
          className={cx(
            'infonomic-checkbox',
            `infonomic-checkbox-${variant}`,
            `infonomic-checkbox-${size}`,
            `infonomic-checkbox-${intent}`,
            styles.checkbox,
            styles[variant],
            styles[size],
            styles[intent],
            checkBoxClasses,
            className
          )}
          {...rest}
        >
          <CheckboxPrimitive.Indicator
            keepMounted
            className={cx('infonomic-checkbox-indicator', styles.indicator)}
          >
            <CheckIcon className={styles.icon} />
          </CheckboxPrimitive.Indicator>
        </CheckboxPrimitive.Root>

        {label != null && (
          <label
            htmlFor={id}
            className={cx('infonomic-checkbox-label', styles.label, labelClasses)}
          >
            {label}
          </label>
        )}
      </div>
      {error ? (
        <ErrorText id={`error-for-${id}`} size={size} text={errorText ?? helpText} />
      ) : (
        helpText?.length > 0 && <HelpText size={size} text={helpText} />
      )}
    </div>
  )
}
