import { installCoreStorage } from '../dist/migrations/index.js'

const connection = process.env.BYLINE_DB_MYSQL_CONNECTION_STRING
if (!connection || !/^\/(?:[\w-]+)_(?:dev|test)$/.test(new URL(connection).pathname)) {
  throw new Error('Local core install requires a designated _dev or _test database')
}
const result = await installCoreStorage(connection)
console.log(`Verified MySQL core storage at version ${result.version}.`)
