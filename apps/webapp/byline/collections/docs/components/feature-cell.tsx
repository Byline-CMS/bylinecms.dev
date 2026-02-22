import type { FormatterProps } from '@byline/core'

export function FeaturedCell({ value, record }: FormatterProps) {
  if (value == null) return null
  return (
    <span title={`"${record.title}" is featured`} className="text-amber-500">
      ★
    </span>
  )
}