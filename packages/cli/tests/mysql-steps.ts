import { createHash } from 'node:crypto'

import type { MysqlStep } from '../../db-mysql/dist/migrations/assets.js'

export function onlineColumns(
  base: MysqlStep,
  release = '6.13.4',
  serverVersions = ['8.0.46', '8.4.13', '9.7.1']
): MysqlStep {
  const columns = ['fixture_a', 'fixture_b']
  const statements = columns.map(
    (name) =>
      `ALTER TABLE \`byline_documents\` ADD COLUMN \`${name}\` INT NULL, ALGORITHM=INPLACE, LOCK=NONE`
  )
  return {
    ...base,
    version: 11,
    name: 'fixture',
    classification: 'online',
    compatible_from: 10,
    statements,
    sha256: createHash('sha256').update(statements.join('--> statement-breakpoint')).digest('hex'),
    stages: columns.map((name, i) => ({
      object: 'byline_documents',
      add: [`column ${8 + i} \`${name}\` int DEFAULT NULL`],
    })),
    online: {
      server_versions: serverVersions,
      evidence: 'Released MySQL readers, writers and workers at every durable prefix',
      tested_releases: { [release]: 10 },
      lock_timeout_ms: 1000,
      statement_timeout_ms: 5000,
    },
  }
}

export function fencedBackfill(base: MysqlStep): MysqlStep {
  const statement = 'UPDATE `byline_documents` SET fixture_a=1 WHERE fixture_a IS NULL'
  return {
    ...base,
    version: 12,
    name: 'backfill',
    classification: 'fenced',
    compatible_from: 12,
    online: undefined,
    statements: [statement],
    sha256: createHash('sha256').update(statement).digest('hex'),
    stages: [
      {
        object: 'byline_documents',
        add: [],
        data: {
          before: 'SELECT 1',
          after: 'SELECT NOT EXISTS(SELECT 1 FROM byline_documents WHERE fixture_a IS NULL)',
        },
      },
    ],
  }
}
