import { timestamp } from 'drizzle-orm/pg-core'

/**
 * Standard timestamp columns for audit trails.
 * Uses precision 6 (microseconds) and timezone (TIMESTAMPTZ).
 *
 * PostgreSQL TIMESTAMPTZ stores values in UTC and converts to/from
 * the session timezone automatically, avoiding ambiguity.
 */
export const timestamps = {
  created_at: timestamp('created_at', { precision: 6, withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp('updated_at', { precision: 6, withTimezone: true }).notNull().defaultNow(),
}
