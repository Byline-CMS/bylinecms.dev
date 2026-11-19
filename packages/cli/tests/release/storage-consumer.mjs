// Each child resolves every Byline import from its own installed release.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const resolve = createRequire(join(process.argv[2], 'package.json')).resolve
const load = (name) => import(pathToFileURL(resolve(name)).href)
const mysql = process.argv[4] === 'mysql'
const adapter = mysql
  ? (await load('@byline/db-mysql')).mysqlAdapter
  : (await load('@byline/db-postgres')).pgAdapter
const { defineCollection, defineWorkflow, initBylineCore } = await load('@byline/core')
const { runDueTasks } = await load('@byline/core/scheduler')
const { createBylineClient } = await load('@byline/client')
const { createSuperAdminContext } = await load('@byline/auth')
const url = new URL(
  mysql
    ? process.env.BYLINE_DB_MYSQL_CONNECTION_STRING
    : process.env.BYLINE_DB_POSTGRES_CONNECTION_STRING
)
if (url.hostname !== '127.0.0.1' || !url.pathname.endsWith('_test'))
  throw new Error('Expected loopback test database')
const collection = defineCollection({
  path: 'compatibility-articles',
  labels: { singular: 'Article', plural: 'Articles' },
  workflow: defineWorkflow({
    draft: { label: 'Draft', verb: 'Draft' },
    published: { label: 'Published', verb: 'Publish' },
  }),
  fields: [{ name: 'title', type: 'text', label: 'Title' }],
})
const db = adapter({
  connectionString: url.href,
  collections: [collection],
  defaultContentLocale: 'en',
})
try {
  const owner = process.argv[3]
  const task = {
    name: `compatibility.${owner}`,
    intervalMs: 60000,
    leaseMs: 60000,
    run: async () => ({ workRemaining: false }),
  }
  const core = await initBylineCore({
    db,
    collections: [collection],
    scheduledPublication: { enabled: true },
    recurringTasks: [task],
    i18n: {
      content: { locales: ['en'], defaultLocale: 'en' },
      admin: { locales: [], defaultLocale: 'en' },
    },
  })
  const client = createBylineClient({
    db,
    collections: [collection],
    requestContext: createSuperAdminContext({ id: '11111111-1111-4111-8111-111111111111' }),
  })
  const articles = client.collection(collection.path)
  process.on('message', async ({ action, label, id }) => {
    try {
      let result
      if (action === 'cycle') {
        const created = await articles.create({ title: label })
        const updated = await articles.update(
          created.documentId,
          { title: `${label} edited` },
          { expectedRevision: created.revision }
        )
        await articles.changeStatus(created.documentId, 'published', {
          expectedRevision: updated.revision,
        })
        result = created.documentId
      } else if (action === 'read') {
        result = (await articles.findById(id, { status: 'published' }))?.fields.title
        assert.equal(result, `${label} edited`)
      } else if (action === 'worker') {
        const summary = await runDueTasks(core, { owner })
        assert.equal(summary.failed, 0)
        result = summary.succeeded
      } else if (action === 'stop') {
        await db.pool.end()
        process.disconnect()
        return
      } else throw Error('Unknown consumer action')
      process.send({ result })
    } catch (error) {
      process.send({ error: error.stack })
    }
  })
  process.send({ result: 'ready' })
} catch (error) {
  await db.pool.end()
  throw error
}
