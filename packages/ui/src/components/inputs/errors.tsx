/**
 * NOTE: Not currently used
 * Adapted from https://remix-forms.seasoned.cc/conf/07
 */

import type { ZodType, z } from 'zod'

type FormattedErrors = z.ZodFormattedError<ZodType<any, any, any>>

// biome-ignore lint/suspicious/noShadowRestrictedNames: <explanation>
export function Error(props: React.JSX.IntrinsicElements['div']): React.JSX.Element {
  return <div {...props} className="mt-1 text-red-700" role="alert" />
}

export function ServerError({
  name,
  errors,
}: {
  name: string
  errors: any
}): React.JSX.Element | null {
  if (errors != null) {
    const error = errors[name as keyof typeof errors] as FormattedErrors
    return error?._errors != null ? (
      <Error id={`error-for-${name}`}>{error._errors.join(' ')}</Error>
    ) : null
  }
  return null
}

export function FieldError({ name, errors }: { name: string; errors: any }): React.JSX.Element {
  const message = errors[name]?.message
  if (message != null) {
    return <Error id={`error-for-${name}`}>{message}</Error>
  }
  return <ServerError name={name} errors={errors} />
}
