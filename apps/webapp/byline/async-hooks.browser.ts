// Browser-only stub for `node:async_hooks`. Aliased into the client
// environment by vite.config.ts so @byline/core's logger module can
// destructure `AsyncLocalStorage` without tripping Vite's
// "module externalized for browser compatibility" warnings.
//
// The runtime behaviour matches @byline/core's own no-op fallback —
// store reads return undefined and `run` just invokes the callback.

export class AsyncLocalStorage<T> {
  getStore(): T | undefined {
    return undefined
  }
  run<R>(_store: T, fn: (...args: unknown[]) => R, ...args: unknown[]): R {
    return fn(...args)
  }
  enterWith(_store: T): void {}
  disable(): void {}
  exit<R>(fn: (...args: unknown[]) => R, ...args: unknown[]): R {
    return fn(...args)
  }
}
