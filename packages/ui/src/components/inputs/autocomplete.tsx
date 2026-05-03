'use client'

import type React from 'react'

import { Autocomplete as AutocompletePrimitive } from '@base-ui/react/autocomplete'
import cx from 'classnames'

import styles from './autocomplete.module.css'
import { ErrorText } from './error-text.jsx'
import { HelpText } from './help-text.jsx'
import { Label } from './label.jsx'
import type { Intent, Size, Variant } from './@types/autocomplete.js'

type AutocompleteRootProps = React.ComponentProps<typeof AutocompletePrimitive.Root>

export interface AutocompleteProps<Item = string>
  extends Omit<AutocompleteRootProps, 'items' | 'children'> {
  id: string
  label?: string
  variant?: Variant
  inputSize?: Size
  intent?: Intent
  required?: boolean
  placeholder?: string
  autoComplete?: string
  error?: boolean
  helpText?: string
  errorText?: string
  emptyText?: string
  className?: string
  inputClassName?: string
  wrapperClassName?: string
  items: Item[]
  children: React.ComponentProps<typeof AutocompletePrimitive.List>['children']
  sideOffset?: number
}

export function Autocomplete<Item = string>({
  id,
  label,
  variant = 'outlined',
  inputSize = 'md',
  intent = 'primary',
  required,
  placeholder = '',
  autoComplete = 'off',
  error = false,
  helpText = '',
  errorText = '',
  emptyText = 'No results found.',
  className,
  inputClassName,
  wrapperClassName,
  items,
  children,
  sideOffset = 4,
  ...rest
}: AutocompleteProps<Item>) {
  return (
    <div
      className={cx(
        'infonomic-autocomplete-wrapper',
        styles['autocomplete-wrapper'],
        wrapperClassName
      )}
    >
      <AutocompletePrimitive.Root items={items} {...rest}>
        {label != null && <Label id={id} htmlFor={id} required={required} label={label} />}
        <AutocompletePrimitive.Input
          id={id}
          placeholder={placeholder}
          autoComplete={autoComplete}
          aria-labelledby={label ? `label-for-${id}` : undefined}
          aria-invalid={error}
          aria-required={required}
          aria-errormessage={error ? errorText : undefined}
          aria-describedby={error ? `error-for-${id}` : undefined}
          className={cx(
            'infonomic-autocomplete-input',
            `infonomic-autocomplete-input-${variant}`,
            `infonomic-autocomplete-input-${inputSize}`,
            `infonomic-autocomplete-input-${intent}`,
            styles.input,
            styles[variant],
            styles[inputSize],
            styles[intent],
            { [styles.error]: error },
            className,
            inputClassName
          )}
        />

        <AutocompletePrimitive.Portal>
          <AutocompletePrimitive.Positioner
            className={cx('infonomic-autocomplete-positioner', styles.positioner)}
            sideOffset={sideOffset}
          >
            <AutocompletePrimitive.Popup
              className={cx(
                'infonomic-autocomplete-popup',
                styles.popup,
                inputSize != null && styles[`popup-${inputSize}`]
              )}
            >
              <AutocompletePrimitive.Empty
                className={cx('infonomic-autocomplete-empty', styles.empty)}
              >
                {emptyText}
              </AutocompletePrimitive.Empty>
              <AutocompletePrimitive.List
                className={cx('infonomic-autocomplete-list', styles.list)}
              >
                {children}
              </AutocompletePrimitive.List>
            </AutocompletePrimitive.Popup>
          </AutocompletePrimitive.Positioner>
        </AutocompletePrimitive.Portal>
      </AutocompletePrimitive.Root>
      {error ? (
        <ErrorText id={`error-for-${id}`} size={inputSize} text={errorText ?? helpText} />
      ) : (
        helpText?.length > 0 && <HelpText size={inputSize} text={helpText} />
      )}
    </div>
  )
}

export const AutocompleteItem = ({
  ref: forwardedRef,
  children,
  className,
  ...props
}: React.ComponentProps<typeof AutocompletePrimitive.Item> & {
  ref?: React.RefObject<HTMLDivElement>
}) => {
  return (
    <AutocompletePrimitive.Item
      className={cx('infonomic-autocomplete-item', styles['autocomplete-item'], className)}
      {...props}
      ref={forwardedRef}
    >
      {children}
    </AutocompletePrimitive.Item>
  )
}

AutocompleteItem.displayName = 'AutocompleteItem'

export const AutocompleteGroup = AutocompletePrimitive.Group
export const AutocompleteGroupLabel = ({
  children,
  className,
  ...props
}: React.ComponentProps<typeof AutocompletePrimitive.GroupLabel>) => {
  return (
    <AutocompletePrimitive.GroupLabel
      className={cx('infonomic-autocomplete-group-label', styles['group-label'], className)}
      {...props}
    >
      {children}
    </AutocompletePrimitive.GroupLabel>
  )
}

AutocompleteGroupLabel.displayName = 'AutocompleteGroupLabel'

export const AutocompleteSeparator = ({
  className,
  ...props
}: React.ComponentProps<typeof AutocompletePrimitive.Separator>) => {
  return (
    <AutocompletePrimitive.Separator
      className={cx('infonomic-autocomplete-separator', styles.separator, className)}
      {...props}
    />
  )
}

AutocompleteSeparator.displayName = 'AutocompleteSeparator'
