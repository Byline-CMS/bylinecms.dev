import { z } from 'zod'

// Host routers may preserve URL values as strings. Boolean('false') is true,
// so boolean coercion cannot be used for an explicit URL direction.
export const searchBooleanSchema = z.preprocess(
  (value) => (value === 'true' ? true : value === 'false' ? false : value),
  z.boolean().optional()
)
