import { installCoreStorage } from '../dist/migrations/index.js'

const connection = process.env.BYLINE_DB_POSTGRES_CONNECTION_STRING
if (!connection || !/^\/(?:[\w-]+)_(?:dev|test)$/.test(new URL(connection).pathname)) {
  throw new Error('Local core install requires a designated _dev or _test database')
}
const { applied } = await installCoreStorage(connection)
console.log(
  applied.length ? `Installed core storage through ${applied.at(-1)}.` : 'Core storage is current.'
)
