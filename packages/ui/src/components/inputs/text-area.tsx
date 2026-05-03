import type * as React from 'react'

import cx from 'classnames'

import { ErrorText } from './error-text.jsx'
import { HelpText } from './help-text.jsx'
import inputStyles from './input.module.css'
import { Label } from './label.jsx'
import styles from './text-area.module.css'
import type { Intent, Variant } from './@types/input.js'

export interface TextAreaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  id: string
  name: string
  label?: string
  required?: boolean
  variant?: Variant
  intent?: Intent
  rows: number
  placeHolder?: string
  autoComplete?: string
  error?: boolean
  helpText?: string
  errorText?: string
  className?: string
  ref?: React.RefCallback<HTMLTextAreaElement | null> | React.RefObject<HTMLTextAreaElement | null>
}

export const TextArea = function TextArea({
  ref,
  id,
  name,
  label,
  rows = 4,
  required = false,
  variant = 'outlined',
  intent = 'primary',
  placeHolder = '',
  autoComplete = 'off',
  error = false,
  helpText = '',
  errorText = '',
  className,
  ...rest
}: TextAreaProps): React.JSX.Element {
  return (
    <div className={cx('text-area-wrapper', inputStyles['input-wrapper'])}>
      {label != null && <Label id={id} htmlFor={id} required={required} label={label} />}
      <textarea
        ref={ref}
        id={id}
        name={name}
        required={required}
        rows={rows}
        autoComplete={autoComplete}
        placeholder={placeHolder}
        aria-labelledby={`label-for-${id}`}
        aria-invalid={error}
        aria-required={required}
        aria-errormessage={errorText}
        aria-describedby={error ? `error-for-${id}` : undefined}
        className={cx(
          'infonomic-text-area',
          `infonomic-text-area-${variant}`,
          `infonomic-text-area-${intent}`,
          inputStyles.input,
          inputStyles[variant],
          inputStyles[intent],
          styles['text-area'],
          styles[variant],
          { [inputStyles.error]: error },
          className
        )}
        {...rest}
      />
      {error ? (
        <ErrorText id={`error-for-${id}`} text={errorText ?? helpText} />
      ) : (
        helpText?.length > 0 && <HelpText text={helpText} />
      )}
    </div>
  )
}
