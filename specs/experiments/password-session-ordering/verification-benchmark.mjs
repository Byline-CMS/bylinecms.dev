import { randomUUID } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { performance } from 'node:perf_hooks'

const base = process.cwd()
const adminRequire = createRequire(`${base}/packages/admin/package.json`)
const { SignJWT, jwtVerify } = await import(adminRequire.resolve('jose'))
const { JwtSessionProvider } = await import(
  `${base}/packages/admin/dist/modules/auth/jwt-session-provider.js`
)
const secret = 'isolated-query-benchmark-not-a-real-signing-secret'
const key = new TextEncoder().encode(secret)
const output = []
for (const dialect of ['postgres', 'mysql']) {
  const req = createRequire(`${base}/packages/db-${dialect}/package.json`)
  const dotenv = req('dotenv')
  const env = dotenv.parse(
    await (await import('node:fs/promises')).readFile(
      `${base}/packages/db-${dialect}/${dialect === 'postgres' ? '.env.test.local' : '.env.test'}`
    )
  )
  const uri =
    env[
      dialect === 'postgres'
        ? 'BYLINE_DB_POSTGRES_CONNECTION_STRING'
        : 'BYLINE_DB_MYSQL_CONNECTION_STRING'
    ]
  if (!uri || !new URL(uri).pathname.endsWith('_test')) throw new Error('Test-only benchmark')
  let connection, db, query
  if (dialect === 'postgres') {
    connection = new (req('pg').Pool)({ connectionString: uri, max: 4 })
    db = req('drizzle-orm/node-postgres').drizzle(connection)
    query = async (sql, values = []) => (await connection.query(sql, values)).rows
  } else {
    connection = req('mysql2/promise').createPool({ uri, connectionLimit: 4 })
    db = req('drizzle-orm/mysql2').drizzle(connection)
    query = async (sql, values = []) => (await connection.execute(sql, values))[0]
  }
  const { createAdminStore } = await import(
    `${base}/packages/db-${dialect}/dist/modules/admin/admin-store.js`
  )
  const store = createAdminStore(db)
  const user = await store.adminUsers.create({
    email: `${randomUUID()}@benchmark.example.test`,
    password_hash: 'not-a-login-credential',
    is_enabled: true,
  })
  try {
    const sid = randomUUID()
    await store.loginSessions.create({
      id: sid,
      admin_user_id: user.id,
      session_version: 0,
      expires_at: new Date(Date.now() + 3600000),
    })
    const token = await new SignJWT({ typ: 'access', sv: 0, sid })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuer('byline')
      .setSubject(user.id)
      .setIssuedAt()
      .setExpirationTime('1h')
      .setJti(randomUUID())
      .sign(key)
    const provider = new JwtSessionProvider({ store, signingSecret: secret })
    const baseline = async () => {
      await jwtVerify(token, key, { issuer: 'byline' })
      const current = await store.adminUsers.getByIdForSignIn(user.id)
      if (!current || current.session_version !== 0) throw new Error('Invalid fixture')
      await store.adminPermissions.listAbilitiesForUser(user.id)
    }
    let count = 1
    for (const size of [1000, 10000]) {
      while (count < size) {
        const n = Math.min(200, size - count)
        const rows = Array.from({ length: n }, (_, i) => ({
          id: randomUUID(),
          admin_user_id: user.id,
          session_version: 0,
          expires_at: new Date(Date.now() + 3600000),
          revoked_at: (count + i) % 2 ? new Date() : null,
        }))
        const { adminLoginSessions } = await import(
          `${base}/packages/db-${dialect}/dist/database/schema/auth.js`
        )
        await db.insert(adminLoginSessions).values(rows)
        count += n
      }
      for (let i = 0; i < 10; i++) {
        await baseline()
        await provider.verifyAccessToken(token)
      }
      const times = { baseline: [], login: [] }
      for (let i = 0; i < 200; i++)
        for (const [label, fn] of i % 2
          ? [
              ['login', () => provider.verifyAccessToken(token)],
              ['baseline', baseline],
            ]
          : [
              ['baseline', baseline],
              ['login', () => provider.verifyAccessToken(token)],
            ]) {
          const start = performance.now()
          await fn()
          times[label].push(performance.now() - start)
        }
      const summarize = (a) => {
        a.sort((x, y) => x - y)
        return {
          p50_ms: a[99],
          p95_ms: a[189],
          p99_ms: a[197],
          serial_ops_per_second: 1000 / (a.reduce((x, y) => x + y, 0) / a.length),
        }
      }
      const plan =
        dialect === 'postgres'
          ? await query(
              'EXPLAIN (FORMAT JSON) SELECT * FROM byline_admin_login_sessions WHERE id = $1',
              [sid]
            )
          : await query('EXPLAIN SELECT * FROM byline_admin_login_sessions WHERE id = ?', [sid])
      output.push({
        dialect,
        login_rows: size,
        samples: 200,
        baseline: summarize(times.baseline),
        with_login: summarize(times.login),
        plan,
      })
    }
  } finally {
    await query(
      `DELETE FROM byline_admin_users WHERE id = ${dialect === 'postgres' ? '$1' : '?'}`,
      [user.id]
    )
    await connection.end()
  }
}
writeFileSync(process.argv[2] ?? '/tmp/byline-d3-benchmark.json', JSON.stringify(output, null, 2))
console.log(
  JSON.stringify(
    output.map(({ plan, ...row }) => row),
    null,
    2
  )
)
