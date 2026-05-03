'use client'

import type React from 'react'

import cx from 'classnames'

import { ErrorText } from './error-text.jsx'
import { HelpText } from './help-text.jsx'
import styles from './input.module.css'
import { Label } from './label.jsx'
import type { Intent, Size, Variant } from './@types/input.js'
import type { InputAdornmentProps } from './input-adornment.jsx'

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  id: string
  name: string
  label?: string
  variant?: Variant
  inputSize?: Size
  intent?: Intent
  required?: boolean
  type?: string
  placeHolder?: string
  autoComplete?: string
  startAdornment?: React.ReactElement<InputAdornmentProps>
  endAdornment?: React.ReactElement<InputAdornmentProps>
  error?: boolean
  helpText?: string
  errorText?: string
  className?: string
  inputWrapperClassName?: string
  ref?: React.RefCallback<HTMLInputElement | null> | React.RefObject<HTMLInputElement | null>
}

export const Input = <_C extends React.ElementType = 'input'>({
  ref,
  id,
  name,
  type = 'text',
  variant = 'outlined',
  inputSize = 'md',
  intent = 'primary',
  required,
  label,
  startAdornment,
  endAdornment,
  placeHolder = '',
  autoComplete = 'off',
  error = false,
  helpText = '',
  errorText = '',
  inputWrapperClassName,
  className,
  ...rest
}: InputProps) => {
  return (
    <div className={cx('infonomic-input-wrapper', styles['input-wrapper'], inputWrapperClassName)}>
      {label != null && <Label id={id} htmlFor={id} required={required} label={label} />}
      <div className={cx('infonomic-input-container', styles['input-container'])}>
        {startAdornment != null && (
          <div
            className={cx(
              'infonomic-input-start-adornment',
              styles['start-adornment'],
              styles[variant]
            )}
          >
            {startAdornment}
          </div>
        )}
        <input
          ref={ref}
          id={id}
          name={name}
          type={type}
          required={required}
          autoComplete={autoComplete}
          placeholder={placeHolder}
          aria-labelledby={`label-for-${id}`}
          aria-invalid={error}
          aria-required={required}
          aria-errormessage={errorText}
          aria-describedby={error ? `error-for-${id}` : undefined}
          className={cx(
            'infonomic-input',
            `infonomic-input-${variant}`,
            `infonomic-input-${inputSize}`,
            `infonomic-input-${intent}`,
            styles.input,
            styles[variant],
            styles[inputSize],
            styles[intent],
            { [styles['start-adornment-padding']]: startAdornment != null },
            { [styles['end-adornment-padding']]: endAdornment != null },
            { [styles.error]: error },
            className
          )}
          {...rest}
        />
        {endAdornment != null && (
          <div
            className={cx(
              'infonomic-input-end-adornment',
              styles['end-adornment'],
              styles[variant]
            )}
          >
            {endAdornment}
          </div>
        )}
      </div>
      {error ? (
        <ErrorText id={`error-for-${id}`} size={inputSize} text={errorText ?? helpText} />
      ) : (
        helpText?.length > 0 && <HelpText size={inputSize} text={helpText} />
      )}
    </div>
  )
}
