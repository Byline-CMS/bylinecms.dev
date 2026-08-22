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
 *   3. Every timestamp (instant) column is `datetime(6)` — microsecond
 *      precision, matching the Postgres adapter's `timestamp(..., {
 *      precision: 6, withTimezone: true })` exactly (see `common.ts`'s
 *      `auditTimestamp` docblock: this was `datetime(3)` originally, and a
 *      live `packages/db-conformance` run caught back-to-back statements on
 *      a fast local connection landing in the same millisecond tick and
 *      receiving an identical `CURRENT_TIMESTAMP(3)` value — a real
 *      correctness gap for anything ordering or windowing by these
 *      columns). Every bare time-of-day column is still `time(3)`,
 *      millisecond precision, so a fractional time value round-trips
 *      instead of silently truncating to whole seconds — `time` values are
 *      user-authored field data, not statement-ordering timestamps, so the
 *      race that motivated the instant-column bump upstream doesn't apply
 *      to them.
 *   4. The `byline_document_paths` live-path-uniqueness index
 *      keeps the exact name `idx_document_paths_collection_locale_path`,
 *      because `packages/core/src/services/document-lifecycle/internals.ts`
 *      substring-matches this name against the adapter's `classifyError`
 *      constraint report to detect path collisions. Its generated `alive`
 *      discriminator is stored and nullable so deleted rows no longer
 *      occupy the live namespace.
 *   5. `byline_document_paths.path` carries the `utf8mb4_bin` collation
 *      (project-owner ruling) so path uniqueness is case- and
 *      accent-sensitive on MySQL exactly like it already is on Postgres —
 *      see `varcharCaseSensitive` in `./common.ts` for the Thai /
 *      Devanagari / Hebrew combining-mark evidence behind the ruling.
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
 * fsp 1-2, 2 bytes for fsp 3-4, 3 bytes for fsp 5-6. Every instant
 * (`datetime`) column in this schema uses fsp 6 (see `common.ts`), which is
 * 3 bytes; the one bare time-of-day column (`value_time`) stays at fsp 3
 * (2 bytes) — see the timestamp-precision pin below for why the two are
 * treated differently.
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
  const char36Columns: { tableName: string; column: AnyMySqlColumn }[] = []
  const orderKeyColumns: { tableName: string; column: AnyMySqlColumn }[] = []

  for (const table of allTables()) {
    const cfg = getTableConfig(table)
    for (const col of cfg.columns) {
      if (col.name === 'order_key') {
        orderKeyColumns.push({ tableName: cfg.name, column: col })
        continue
      }
      // Asserted on the rendered *type* (any `char(36)` column) rather
      // than the column *name* (`id` / `*_id`) — a name-pattern rule
      // missed `documentVersions.created_by`, which is a `uuidChar`
      // column that doesn't end in `_id`. Matching on type instead means
      // every 36-char fixed-width column in the schema is held to this
      // pin regardless of what it's called, and a column that renders as
      // `char(36)` but isn't the `uuidChar` (ascii_bin) flavor fails the
      // assertion below rather than escaping the check entirely.
      if (/^char\(36\)/i.test(col.getSQLType())) {
        char36Columns.push({ tableName: cfg.name, column: col })
      }
    }
  }

  it('finds char(36) columns to check (schema is not empty)', () => {
    expect(char36Columns.length).toBeGreaterThan(0)
  })

  it('finds order_key columns to check (schema is not empty)', () => {
    expect(orderKeyColumns.length).toBeGreaterThan(0)
  })

  it.each(char36Columns.map((c) => [`${c.tableName}.${c.column.name}`, c.column] as const))(
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
  const instantColumns: { tableName: string; column: AnyMySqlColumn }[] = []
  const timeColumns: { tableName: string; column: AnyMySqlColumn }[] = []

  // Any temporal type that represents an instant (date + time-of-day) must
  // be `datetime(6)`. `MySqlDateTime` is what `datetime()` produces —
  // every timestamp column in this schema uses it — but a future column
  // accidentally declared with mysql-core's `timestamp()` builder instead
  // would produce `MySqlTimestamp` (rendered `timestamp(N)`, a distinct
  // MySQL type this schema never intends to use, so it would fail the
  // `datetime(6)` assertion below regardless of its own fsp). Filtering on
  // `MySqlDateTime` alone would silently skip that column rather than
  // failing it, so both instant-shaped types are checked here.
  const INSTANT_COLUMN_TYPES = new Set(['MySqlDateTime', 'MySqlTimestamp'])

  for (const table of allTables()) {
    const cfg = getTableConfig(table)
    for (const col of cfg.columns) {
      if (INSTANT_COLUMN_TYPES.has(col.columnType)) {
        instantColumns.push({ tableName: cfg.name, column: col })
      }
      if (col.columnType === 'MySqlTime') {
        timeColumns.push({ tableName: cfg.name, column: col })
      }
    }
  }

  it('finds datetime columns to check (schema is not empty)', () => {
    expect(instantColumns.length).toBeGreaterThan(0)
  })

  it.each(instantColumns.map((c) => [`${c.tableName}.${c.column.name}`, c.column] as const))(
    '%s is datetime(6) — microsecond precision (pg parity)',
    (_label, column) => {
      expect(column.getSQLType()).toBe('datetime(6)')
    }
  )

  // `MySqlDate` (the `date()` builder, used by `datetimeStore.value_date`)
  // is the one temporal type genuinely outside this pin's scope — a
  // calendar date has no time-of-day component to lose precision on, so
  // there is nothing for an fsp pin to assert.
  //
  // `MySqlTime` used to get the same pass, on the theory that a bare
  // time-of-day was a different concept from a timestamped instant. That
  // reasoning was wrong: `time` is a real Byline field type
  // (`packages/core/src/storage/field-store-map.ts`), and an unspecified
  // `fsp` defaults to whole-second precision on MySQL — silently
  // truncating a fractional time value that round-trips fine on Postgres,
  // whose `time` column (also declared with no explicit precision on that
  // side) defaults to microsecond precision. The exclusion is now a
  // positive assertion instead.
  it('finds time columns to check (schema is not empty)', () => {
    expect(timeColumns.length).toBeGreaterThan(0)
  })

  it.each(timeColumns.map((c) => [`${c.tableName}.${c.column.name}`, c.column] as const))(
    '%s is time(3) — millisecond precision',
    (_label, column) => {
      expect(column.getSQLType()).toBe('time(3)')
    }
  )
})

describe('schema pins — document-paths unique index name (spec §E)', () => {
  it('pins the live-path and document-locale unique keys', () => {
    const cfg = getTableConfig(coreSchema.documentPaths)
    const pathKey = cfg.uniqueConstraints.find(
      (uc) => uc.name === 'idx_document_paths_collection_locale_path'
    )
    expect(pathKey).toBeDefined()
    expect(pathKey?.columns.map((c) => c.name)).toEqual([
      'collection_id',
      'locale',
      'path',
      'alive',
    ])

    const documentLocaleKey = cfg.uniqueConstraints.find(
      (uc) => uc.name === 'unique_document_paths_document_locale'
    )
    expect(documentLocaleKey?.columns.map((c) => c.name)).toEqual(['document_id', 'locale'])

    const width = (pathKey?.columns ?? []).reduce(
      (sum, column) =>
        sum +
        indexColumnByteWidth(
          'byline_document_paths',
          'idx_document_paths_collection_locale_path',
          column
        ),
      0
    )
    expect(width).toBe(1097)
  })

  it('pins nullable deleted_at and the stored generated alive discriminator', () => {
    const cfg = getTableConfig(coreSchema.documentPaths)
    const deletedAt = cfg.columns.find((column) => column.name === 'deleted_at')
    const alive = cfg.columns.find((column) => column.name === 'alive')

    expect(deletedAt?.getSQLType()).toBe('datetime(6)')
    expect(deletedAt?.notNull).toBe(false)
    expect(alive?.getSQLType()).toBe('boolean')
    expect(alive?.notNull).toBe(false)
    expect(alive?.generated).toMatchObject({ type: 'always', mode: 'stored' })
  })
})

describe('schema pins — document-paths case-sensitive collation (project-owner ruling)', () => {
  // `path` must resolve to `utf8mb4_bin` — not the database's default
  // `utf8mb4_0900_ai_ci` — so path uniqueness is case- AND
  // accent-sensitive on MySQL exactly like it already is on Postgres
  // (whose default collation folds neither). Verified against a live
  // server: MySQL's default collation also collapses non-Latin combining
  // marks Byline's slugifier deliberately preserves (Thai tone marks,
  // Devanagari anusvara, Hebrew niqqud — see
  // `packages/core/src/utils/slugify.ts`), so two documents intended as
  // distinct would silently collide as one path on MySQL only. See
  // `varcharCaseSensitive` in `./common.ts` for the full ruling.
  it('byline_document_paths.path is varchar(255) COLLATE utf8mb4_bin', () => {
    const cfg = getTableConfig(coreSchema.documentPaths)
    const pathColumn = cfg.columns.find((c) => c.name === 'path')
    expect(pathColumn).toBeDefined()
    expect(pathColumn?.getSQLType()).toBe('varchar(255) COLLATE utf8mb4_bin')
  })
})

describe('schema pins — scheduled publication', () => {
  const cfg = getTableConfig(coreSchema.documentPublishSchedules)

  it('pins one row per document and exactly the three lifecycle ownership foreign keys', () => {
    const documentId = cfg.columns.find((column) => column.name === 'document_id')
    expect(documentId?.primary).toBe(true)

    const references = cfg.foreignKeys.map((foreignKey) => ({
      name: foreignKey.getName(),
      local: foreignKey.reference().columns.map((column) => column.name),
      onDelete: foreignKey.onDelete,
    }))
    expect(references).toEqual([
      {
        name: 'fk_publish_schedules_document',
        local: ['document_id'],
        onDelete: 'cascade',
      },
      {
        name: 'fk_publish_schedules_collection',
        local: ['collection_id'],
        onDelete: 'cascade',
      },
      {
        name: 'fk_publish_schedules_target_version',
        local: ['target_version_id'],
        onDelete: 'cascade',
      },
    ])
  })

  it('pins the bounded state and suspension-reason constraints', () => {
    expect(cfg.checks.map((constraint) => constraint.name).sort()).toEqual([
      'check_publish_schedules_state',
      'check_publish_schedules_suspended_reason',
    ])
  })

  it('pins state as the MySQL due-index discriminator and execution-expiry recovery', () => {
    const due = cfg.indexes.find(
      (candidate) => candidate.config.name === 'idx_document_publish_schedules_due'
    )
    expect(due?.config.columns.map((column) => ('name' in column ? column.name : null))).toEqual([
      'state',
      'next_attempt_at',
      'publish_at',
    ])

    const expiry = cfg.indexes.find(
      (candidate) => candidate.config.name === 'idx_document_publish_schedules_execution_expiry'
    )
    expect(expiry?.config.columns.map((column) => ('name' in column ? column.name : null))).toEqual(
      ['execution_expires_at']
    )
  })
})
