export interface PgConn {
  host: string
  port: number
  user: string
  password: string
  database: string
}

export function buildPgUrl(c: PgConn): string {
  const u = encodeURIComponent(c.user)
  const p = encodeURIComponent(c.password)
  return `postgresql://${u}:${p}@${c.host}:${c.port}/${encodeURIComponent(c.database)}`
}

export function parsePgUrl(raw: string): PgConn {
  const url = new URL(raw)
  if (url.protocol !== 'postgresql:' && url.protocol !== 'postgres:') {
    throw new Error(`expected postgresql:// URL, got ${url.protocol}`)
  }
  return {
    host: url.hostname,
    port: url.port ? Number(url.port) : 5432,
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: url.pathname.replace(/^\//, '') || 'postgres',
  }
}

export function withDatabase(c: PgConn, database: string): PgConn {
  return { ...c, database }
}
