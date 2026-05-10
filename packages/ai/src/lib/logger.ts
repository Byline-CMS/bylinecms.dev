// TODO: refactor our singletons to use some sort of container
// or context - like https://github.com/jeffijoe/awilix

import type { BaseLogger } from 'pino'
import logger from 'pino'

let cached: BaseLogger | undefined

export const getLogger = (): BaseLogger => {
  if (cached == null) {
    cached = logger({ level: 'debug' })
  }
  return cached
}
