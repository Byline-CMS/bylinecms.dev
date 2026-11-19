import type { ChildProcess } from 'node:child_process'
import { once } from 'node:events'
export async function reply(child: ChildProcess) {
  const ac = new AbortController()
  try {
    const [response] = await Promise.race([
      once(child, 'message', { signal: ac.signal }),
      once(child, 'exit', { signal: ac.signal }).then(([code]) => {
        throw Error(`Consumer exited ${code}`)
      }),
    ])
    if (response.error) throw Error(response.error)
    return response.result
  } finally {
    ac.abort()
  }
}
export async function call(child: ChildProcess, action: string, label?: string, id?: string) {
  const response = reply(child)
  child.send({ action, label, id })
  return response
}
