// Repeated-navigation driver used with geometry-probe.js. Paste into the console of a
// page already carrying the probe, then call `await __ab(6)`.
//
// `ms` is navigation-to-double-requestAnimationFrame: a proxy for paint, quantised at
// about 16.7 ms. Differences below one frame are not resolvable by it.
//
// Keep the tab VISIBLE for the whole run and record `document.visibilityState` with
// every sample, not once at the start.
;(() => {
  const P = window.__probe
  if (P == null) return 'install geometry-probe.js first'

  const frame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
  const until = async (fn, limit = 15000) => {
    const t = performance.now()
    while (performance.now() - t < limit) {
      if (fn()) return true
      await new Promise((r) => requestAnimationFrame(r))
    }
    return false
  }
  const btn = (label) =>
    [...document.querySelectorAll('button')].find((b) => (b.textContent || '').trim() === label)

  // Editor <-> API round trip. Adapt `settle` for other transitions.
  window.__ab = async (n) => {
    const rows = []
    for (let i = 0; i < n; i++) {
      await until(() => btn('API'))
      await new Promise((r) => setTimeout(r, 400))
      P.reset()
      const t0 = performance.now()
      btn('API').click()
      await until(() => document.querySelector('.byline-api-viewer'))
      await frame()
      rows.push({
        vis: document.visibilityState,
        ms: +(performance.now() - t0).toFixed(1),
        reads: P.reads,
        readMs: +P.ms.toFixed(1),
        maxRead: +P.max.toFixed(1),
        long: [...P.longtasks],
        viewerNodes: document.querySelectorAll('.byline-api-viewer *').length,
      })
      await new Promise((r) => setTimeout(r, 400))
      await until(() => btn('Edit'))
      btn('Edit').click()
      await until(() => document.querySelector('.byline-admin-tablist'))
      await frame()
    }
    return rows
  }

  // React ignores a direct `el.value = …` assignment; drive its value tracker instead.
  window.__keystrokes = async (id, n = 10) => {
    const el = document.getElementById(id)
    if (el == null) return `no field #${id}`
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    el.focus()
    P.reset()
    for (let i = 0; i < n; i++) {
      setter.call(el, `${el.value}x`)
      el.dispatchEvent(new Event('input', { bubbles: true }))
      await new Promise((r) => setTimeout(r, 60))
    }
    return { vis: document.visibilityState, reads: P.reads, readMs: +P.ms.toFixed(1) }
  }

  return 'driver ready: await __ab(6) / await __keystrokes("title")'
})()
