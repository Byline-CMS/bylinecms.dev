/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 *
 * Schema pins — driven entirely off the Drizzle schema objects in
 * `./index.ts` / `./auth.ts`, not a live database. These pin the
 * dialect-critical properties spelled out in the Task 8 controller
 * amendments (§F):
 *
 *   1. Every index's worst-case byte width — unique keys, primary keys,
 *      *and* plain secondary indexes — stays under InnoDB's 3072-byte
 *      `DYNAMIC` row-format index-key cap. Non-unique indexes are included
 *      deliberately: the binding constraint on some tables (e.g.
 *      `idx_text_path_value`) is a secondary index, not the table's
 *      tightest unique key, so checking unique keys alone would miss it.
 *   2. Every id / FK column and every `order_key` column resolves to the
 *      `ascii_bin` collation (byte-wise, case-sensitive comparison —
 *      what makes id equality case-sensitive and `order_key`'s DB sort
 *      match JS string sort on the `generateKeyBetween` alphabet).
 *   3. Every timestamp column is `datetime(3)` — millisecond precision.
 *   4. The `byline_document_paths` per-collection path-uniqueness index
 *      keeps the exact name `idx_document_paths_collection_locale_path`,
 *      because `packages/core/src/services/document-lifecycle/internals.ts`
 *      substring-matches this name against the adapter's `classifyError`
 *      constraint report to detect path collisions.
 *
 * Computed generically over the schema so a future column widening (or a
 * new `_id` column that forgets `uuidChar`) trips this test rather than
 * surfacing later as a mysterious production failure.
 */

import { is, SQL } from 'drizzle-orm'
import { type AnyMySqlColumn, getTableConfig, MySqlTable } from 'drizzle-orm/mysql-core'
import { describe, expect, it } from 'vitest'

import * as authSchema from './auth.js'
import * as coreSchema from './index.js'

// InnoDB's DYNAMIC row format (the default since MySQL 5.7 with
// innodb_large_prefix on, which is the default from 8.0 on) caps a single
// index key at 3072 bytes.
const INNODB_INDEX_KEY_BYTE_CAP = 3072

// Column names that end in `_id` (or are literally `id`) but are NOT
// uuid-shaped FK/PK columns, so they are exempt from the `uuidChar`
// (ascii_bin, char(36)) pin. Kept as an explicit, reviewable allowlist —
// mirrors the pg schema's `metaStore.item_id`, which is deliberately a
// generic `varchar(255)` identifier, not a `uuid` column, because it is
// merely "exposed to the dashboard/API" rather than referencing another
// table's primary key.
const ID_COLUMN_UUID_EXEMPTIONS = new Set(['item_id'])

function allTables(): MySqlTable[] {
  const tables: MySqlTable[] = []
  for (const value of [...Object.values(coreSchema), ...Object.values(authSchema)]) {
    if (is(value, MySqlTable)) {
      tables.push(value)
    }
  }
  return tables
}

/**
 * `ascii` counts 1 byte per character; anything else (the database's
 * `utf8mb4` default charset) counts the InnoDB worst case of 4 bytes per
 * character. Shared by both the whole-column and the prefixed-expression
 * sizing below.
 */
function bytesPerChar(sqlType: string): number {
  return /character set ascii/i.test(sqlType) ? 1 : 4
}

/**
 * Bytes of fractional-seconds storage MySQL adds to a `TIME`/`DATETIME`/
 * `TIMESTAMP` base width for a given `fsp` (0-6): 0 for fsp 0, 1 byte for
 * fsp 1-2, 2 bytes for fsp 3-4, 3 bytes for fsp 5-6. Byline uses fsp 3
 * uniformly (see `common.ts`), which is 2 bytes.
 */
function fractionalSecondsBytes(fsp: number): number {
  if (fsp === 0) return 0
  if (fsp <= 2) return 1
  if (fsp <= 4) return 2
  return 3
}

/**
 * InnoDB's packed-`DECIMAL` storage: 9 decimal digits pack into 4 bytes,
 * with a partial-group table for the leftover 0-8 digits, applied
 * separately to the integer and fractional digit counts.
 */
function decimalStorageBytes(precision: number, scale: number): number {
  const partialGroupBytes = [0, 1, 1, 2, 2, 3, 3, 4, 4]
  const digitBytes = (digits: number) => {
    const fullGroups = Math.floor(digits / 9)
    const leftover = digits % 9
    return fullGroups * 4 + (partialGroupBytes[leftover] ?? 0)
  }
  return digitBytes(precision - scale) + digitBytes(scale)
}

/**
 * Worst-case byte width of a single column, given its rendered MySQL type
 * string. `char`/`varchar` size by declared length × charset width (e.g.
 * `varchar(500) CHARACTER SET ascii COLLATE ascii_bin`, or plain
 * `varchar(10)` for the database's default `utf8mb4` charset — see
 * `bytesPerChar`). Every other column type this schema's indexes actually
 * use (fixed-width numerics, dates, and instants) is sized by its known
 * InnoDB on-disk storage width, because the 3072-byte index-key cap
 * applies to the whole key, not just its string-typed columns — a wide
 * secondary index that mixes an id column with a handful of `int`/
 * `datetime` columns still has to fit.
 */
function columnByteWidth(columnName: string, sqlType: string): number {
  const stringMatch = sqlType.match(/^(?:char|varchar)\((\d+)\)/i)
  if (stringMatch?.[1]) {
    return Number(stringMatch[1]) * bytesPerChar(sqlType)
  }

  const typeMatch = sqlType.match(/^([a-z]+)(?:\(([^)]*)\))?/i)
  const typeName = typeMatch?.[1]?.toLowerCase()
  const args = typeMatch?.[2]

  switch (typeName) {
    case 'boolean':
    case 'tinyint':
      return 1
    case 'smallint':
      return 2
    case 'mediumint':
      return 3
    case 'int':
      return 4
    case 'bigint':
      return 8
    case 'float':
      return 4
    case 'double':
      return 8
    case 'decimal': {
      const parts = (args ?? '').split(',').map(Number)
      const precision = parts[0] ?? Number.NaN
      const scale = parts[1] ?? Number.NaN
      if (!Number.isFinite(precision) || !Number.isFinite(scale)) break
      return decimalStorageBytes(precision, scale)
    }
    case 'date':
      return 3
    case 'time':
      return 3 + fractionalSecondsBytes(args ? Number(args) : 0)
    case 'datetime':
      return 5 + fractionalSecondsBytes(args ? Number(args) : 0)
    case 'timestamp':
      return 4 + fractionalSecondsBytes(args ? Number(args) : 0)
    default:
      break
  }

  throw new Error(
    `schema-pins: column '${columnName}' has SQL type '${sqlType}', which this byte-budget ` +
      'computation does not know how to size. Widen the pin to understand the new type — ' +
      'a column this schema-pin test cannot size is a column whose worst-case index-key ' +
      'contribution nothing is checking.'
  )
}

/**
 * Worst-case byte width of one index column, which is either a plain
 * `MySqlColumn` or a prefixed expression built via `sql\`${table.col}(N)\``
 * (the shape `idx_text_value` / `idx_text_path_value` / etc. use to index
 * into the `TEXT` `value` column — MySQL requires an explicit key-length
 * prefix on any index over a `TEXT`/`BLOB` column). For a prefixed
 * expression, drizzle's `SQL` wraps the underlying column and a trailing
 * `StringChunk` literal holding the `(N)` prefix syntax; the prefix
 * length — not the column's own (possibly unbounded) declared length —
 * is what actually goes into the index key, so it is sized directly
 * rather than by widening the "whole column" case artificially.
 */
function indexColumnByteWidth(
  tableName: string,
  keyName: string,
  col: AnyMySqlColumn | SQL
): number {
  if (!is(col, SQL)) {
    return columnByteWidth(col.name, col.getSQLType())
  }

  let underlyingColumn: AnyMySqlColumn | undefined
  let prefixLength: number | undefined
  for (const chunk of col.queryChunks) {
    if (chunk && typeof chunk === 'object' && 'getSQLType' in chunk) {
      underlyingColumn = chunk as AnyMySqlColumn
      continue
    }
    if (chunk && typeof chunk === 'object' && 'value' in chunk) {
      const text = (chunk as { value: unknown[] }).value.join('')
      const m = text.match(/\((\d+)\)/)
      if (m?.[1]) prefixLength = Number(m[1])
    }
  }

  if (!underlyingColumn || prefixLength === undefined) {
    throw new Error(
      `schema-pins: index '${tableName}.${keyName}' contains a raw SQL expression this ` +
        'byte-budget computation does not know how to size (expected a `${column}(N)` ' +
        'key-length prefix). Widen the pin to understand the new expression shape.'
    )
  }

  return prefixLength * bytesPerChar(underlyingColumn.getSQLType())
}

interface NamedKey {
  tableName: string
  keyName: string
  columns: (AnyMySqlColumn | SQL)[]
}

/**
 * Every index-shaped structure declared on the schema — unique
 * constraints, column-level `.unique()` markers, primary keys (composite
 * and single-column), *and* plain secondary `index(...)` declarations.
 * InnoDB's 3072-byte `DYNAMIC` key cap applies to every index on a table,
 * not just the unique ones — a wide-but-non-unique index (e.g.
 * `idx_text_path_value` on `(field_path, value(191))`) can be the
 * tightest key on a table even when every *unique* key has headroom to
 * spare, so checking only `uniqueConstraints` would let exactly the kind
 * of widening this pin exists to catch slip through unpinned.
 */
function allIndexLikeKeys(): NamedKey[] {
  const keys: NamedKey[] = []
  for (const table of allTables()) {
    const cfg = getTableConfig(table)

    for (const uc of cfg.uniqueConstraints) {
      keys.push({
        tableName: cfg.name,
        keyName: uc.name ?? '(unnamed unique)',
        columns: uc.columns,
      })
    }

    for (const col of cfg.columns) {
      if (col.isUnique) {
        keys.push({
          tableName: cfg.name,
          keyName: col.uniqueName ?? `${cfg.name}_${col.name}_unique`,
          columns: [col],
        })
      }
    }

    for (const pk of cfg.primaryKeys) {
      keys.push({
        tableName: cfg.name,
        keyName: pk.getName() || `${cfg.name}_pkey`,
        columns: pk.columns,
      })
    }

    const singleColPk = cfg.columns.filter((c) => c.primary)
    if (singleColPk.length > 0 && cfg.primaryKeys.length === 0) {
      keys.push({
        tableName: cfg.name,
        keyName: `${cfg.name}_pkey`,
        columns: singleColPk,
      })
    }

    for (const idx of cfg.indexes) {
      keys.push({
        tableName: cfg.name,
        keyName: idx.config.name,
        columns: idx.config.columns,
      })
    }
  }
  return keys
}

describe('schema pins — index byte budget (spec §F.1)', () => {
  const keys = allIndexLikeKeys()

  it('finds indexes to check (schema is not empty)', () => {
    expect(keys.length).toBeGreaterThan(0)
  })

  it.each(keys.map((k) => [`${k.tableName}.${k.keyName}`, k] as const))(
    '%s stays within the 3072-byte InnoDB DYNAMIC index-key cap',
    (_label, key) => {
      const width = key.columns.reduce(
        (sum, col) => sum + indexColumnByteWidth(key.tableName, key.keyName, col),
        0
      )
      expect(width).toBeLessThanOrEqual(INNODB_INDEX_KEY_BYTE_CAP)
    }
  )

  it('the tightest store-table unique key (document_version_id, field_path, locale) is exactly 2076 bytes', () => {
    const textStoreKey = keys.find(
      (k) => k.tableName === 'byline_store_text' && k.keyName === 'unique_text_field'
    )
    expect(textStoreKey).toBeDefined()
    const width = (textStoreKey as NamedKey).columns.reduce(
      (sum, col) => sum + indexColumnByteWidth('byline_store_text', 'unique_text_field', col),
      0
    )
    expect(width).toBe(2076)
  })

  it('the tightest non-unique index on that table, idx_text_path_value (field_path + a value(191) prefix), is exactly 2764 bytes', () => {
    const idx = keys.find(
      (k) => k.tableName === 'byline_store_text' && k.keyName === 'idx_text_path_value'
    )
    expect(idx).toBeDefined()
    const width = (idx as NamedKey).columns.reduce(
      (sum, col) => sum + indexColumnByteWidth('byline_store_text', 'idx_text_path_value', col),
      0
    )
    expect(width).toBe(2764)
  })
})

describe('schema pins — ascii_bin collation (spec §F.2)', () => {
  const idColumns: { tableName: string; column: AnyMySqlColumn }[] = []
  const orderKeyColumns: { tableName: string; column: AnyMySqlColumn }[] = []

  for (const table of allTables()) {
    const cfg = getTableConfig(table)
    for (const col of cfg.columns) {
      if (col.name === 'order_key') {
        orderKeyColumns.push({ tableName: cfg.name, column: col })
        continue
      }
      const looksLikeIdColumn = col.name === 'id' || col.name.endsWith('_id')
      if (looksLikeIdColumn && !ID_COLUMN_UUID_EXEMPTIONS.has(col.name)) {
        idColumns.push({ tableName: cfg.name, column: col })
      }
    }
  }

  it('finds id columns to check (schema is not empty)', () => {
    expect(idColumns.length).toBeGreaterThan(0)
  })

  it('finds order_key columns to check (schema is not empty)', () => {
    expect(orderKeyColumns.length).toBeGreaterThan(0)
  })

  it.each(idColumns.map((c) => [`${c.tableName}.${c.column.name}`, c.column] as const))(
    '%s is char(36) CHARACTER SET ascii COLLATE ascii_bin (uuidChar)',
    (_label, column) => {
      expect(column.getSQLType()).toBe('char(36) CHARACTER SET ascii COLLATE ascii_bin')
    }
  )

  it.each(orderKeyColumns.map((c) => [`${c.tableName}.${c.column.name}`, c.column] as const))(
    '%s is varchar(128) CHARACTER SET ascii COLLATE ascii_bin (varcharByteSorted)',
    (_label, column) => {
      expect(column.getSQLType()).toBe('varchar(128) CHARACTER SET ascii COLLATE ascii_bin')
    }
  )
})

describe('schema pins — timestamp precision (spec §F.3)', () => {
  const datetimeColumns: { tableName: string; column: AnyMySqlColumn }[] = []

  // Any temporal type that represents an instant (date + time-of-day) must
  // be `datetime(3)`. `MySqlDateTime` is what `datetime()` produces —
  // every timestamp column in this schema uses it — but a future column
  // accidentally declared with mysql-core's `timestamp()` builder instead
  // would produce `MySqlTimestamp` (rendered `timestamp(3)`, a distinct
  // MySQL type this schema never intends to use). Filtering on
  // `MySqlDateTime` alone would silently skip that column rather than
  // failing it, so both instant-shaped types are checked here.
  // `MySqlDate` / `MySqlTime` (the `date()` / `time()` builders used by
  // `datetimeStore.value_date` / `value_time`) are deliberately excluded —
  // those store a calendar date or a time-of-day alone, a different
  // concept from a timestamped instant, and are not held to this pin.
  const INSTANT_COLUMN_TYPES = new Set(['MySqlDateTime', 'MySqlTimestamp'])

  for (const table of allTables()) {
    const cfg = getTableConfig(table)
    for (const col of cfg.columns) {
      if (INSTANT_COLUMN_TYPES.has(col.columnType)) {
        datetimeColumns.push({ tableName: cfg.name, column: col })
      }
    }
  }

  it('finds datetime columns to check (schema is not empty)', () => {
    expect(datetimeColumns.length).toBeGreaterThan(0)
  })

  it.each(datetimeColumns.map((c) => [`${c.tableName}.${c.column.name}`, c.column] as const))(
    '%s is datetime(3) — millisecond precision',
    (_label, column) => {
      expect(column.getSQLType()).toBe('datetime(3)')
    }
  )
})

describe('schema pins — document-paths unique index name (spec §E)', () => {
  it('byline_document_paths carries a unique key literally named idx_document_paths_collection_locale_path', () => {
    const cfg = getTableConfig(coreSchema.documentPaths)
    const pathKey = cfg.uniqueConstraints.find(
      (uc) => uc.name === 'idx_document_paths_collection_locale_path'
    )
    expect(pathKey).toBeDefined()
    expect(pathKey?.columns.map((c) => c.name)).toEqual(['collection_id', 'locale', 'path'])
  })
})
