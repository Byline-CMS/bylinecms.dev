/**
 * Run every lifecycle side effect, then report all failures together. Effects
 * are invoked synchronously in declaration order before awaiting settlement,
 * which lets delete hooks start search removal before cache invalidation.
 */
export async function runSideEffects(
  label: string,
  ...effects: Array<() => void | Promise<void>>
): Promise<void> {
  const pending = effects.map((effect) => {
    try {
      return Promise.resolve(effect())
    } catch (error) {
      return Promise.reject(error)
    }
  })
  const failures = (await Promise.allSettled(pending))
    .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
    .map((result) => result.reason)
  if (failures.length === 0) return

  const error = new AggregateError(failures, `${label}: ${failures.length} side effect(s) failed`)
  console.error(error)
  throw error
}
