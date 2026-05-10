import { describe, test } from 'vitest'

import { getAiServerConfig } from './ai-config'

describe('Config tests', () => {
  // NOTE: Disable caching in getAiServerConfig for 'real'
  // benchmarks
  test.skip('should get config quickly', () => {
    // Record the start time
    const startTime = performance.now()
    const iterations = 10000
    let _config: any
    for (let i = 0; i < iterations; i++) {
      // const start = performance.now();
      _config = getAiServerConfig()
      // totalTime += performance.now() - start;
    }

    // Record the end time
    const endTime = performance.now()

    // Calculate the time taken
    const timeTaken = endTime - startTime
    console.log(`Execution time: ${timeTaken}ms`)
    // console.log(config)
  })
})
