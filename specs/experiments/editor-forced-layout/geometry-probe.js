// Geometry-read probe for admin-UI layout investigations (issues #99, #100).
//
// Paste into a browser console to instrument an already-loaded page, or add it to
// `apps/webapp/src/client.tsx` immediately above `hydrateRoot` to instrument a full
// page load — nothing injected after load can observe hydration. Remove it again
// before committing.
//
// It counts GEOMETRY READS, not forced layouts. A getter that reads already-clean
// layout is counted too and costs nothing; only a read with non-trivial duration
// forced layout. Summed durations are a proxy for the cost of those reads, never a
// measure of the browser's layout time, and they say nothing about what invalidated
// layout beforehand. Only a recorded Performance trace answers that.
//
// The timed region brackets the native getter alone, so stack capture and bookkeeping
// stay out of the number.
;(() => {
  if (window.__probe) return 'already installed'
  const P = {
    reads: 0,
    ms: 0,
    max: 0,
    tabsMs: 0,
    crumbMs: 0,
    sites: [],
    longtasks: [],
  }
  window.__probe = P

  const wrap = (proto, prop) => {
    const desc = Object.getOwnPropertyDescriptor(proto, prop)
    if (desc == null || desc.get == null) return
    Object.defineProperty(proto, prop, {
      configurable: true,
      get() {
        const t0 = performance.now()
        const v = desc.get.call(this)
        const dt = performance.now() - t0
        P.reads++
        P.ms += dt
        if (dt > P.max) P.max = dt
        try {
          if (this.closest?.('.byline-admin-tabs')) P.tabsMs += dt
          else if (this.closest?.('.byline-breadcrumbs')) P.crumbMs += dt
        } catch {}
        if (dt > 3 && P.sites.length < 20) {
          P.sites.push({
            prop,
            ms: +dt.toFixed(1),
            el: String(this.className || this.tagName).slice(0, 40),
          })
        }
        return v
      },
    })
  }

  // `clientWidth` and `scrollWidth` live on Element.prototype; `offsetWidth` and
  // friends on HTMLElement.prototype. Wrapping only one of the two silently measures
  // nothing and reports a misleading zero — run a positive control before trusting
  // any result.
  for (const p of ['scrollWidth', 'clientWidth', 'scrollHeight', 'clientHeight']) {
    wrap(Element.prototype, p)
  }
  for (const p of ['offsetWidth', 'offsetHeight', 'offsetLeft', 'offsetTop']) {
    wrap(HTMLElement.prototype, p)
  }

  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) P.longtasks.push(+e.duration.toFixed(1))
    }).observe({ entryTypes: ['longtask'] })
  } catch {}

  P.reset = () => {
    P.reads = 0
    P.ms = 0
    P.max = 0
    P.tabsMs = 0
    P.crumbMs = 0
    P.sites.length = 0
    P.longtasks.length = 0
  }

  // Record this with every sample. An occluded window reports 'hidden', Chrome then
  // performs no rendering, and the numbers are void — see README.
  return `installed; visibilityState=${document.visibilityState}`
})()
