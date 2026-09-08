/** Retry only InnoDB deadlock victims: error 1213 guarantees transaction rollback. */
export async function retryDeadlock<T>(operation: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await operation()
    } catch (error) {
      let cause: unknown = error
      let deadlock = false
      for (let depth = 0; depth < 8 && cause && typeof cause === 'object'; depth++) {
        if ('errno' in cause && cause.errno === 1213) {
          deadlock = true
          break
        }
        cause = 'cause' in cause ? cause.cause : undefined
      }
      if (!deadlock || attempt >= 2) throw error
      await new Promise((resolve) => setTimeout(resolve, 10 * 2 ** attempt + Math.random() * 10))
    }
  }
}
