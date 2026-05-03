import type { z } from 'zod'

type FormattedErrors = z.ZodFormattedError<any>

export function hasErrors(name: string, clientErrors: any, serverErrors: any): boolean {
  return Boolean(serverErrors?.[name as keyof typeof serverErrors] ?? clientErrors[name])
}

export function getErrorText(
  name: string,
  clientErrors: any,
  serverErrors: any
): string | undefined {
  const message = clientErrors[name]?.message
  if (message != null) return message
  const error =
    serverErrors != null
      ? (serverErrors[name as keyof typeof serverErrors] as FormattedErrors)
      : undefined
  if (error?._errors != null) return error._errors.join(' ')
}
