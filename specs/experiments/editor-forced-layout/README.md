# Forced layout when opening collection editors

Measurements taken on 2026-09-15 while investigating
[#100](https://github.com/Byline-CMS/bylinecms.dev/issues/100) (forced layout on editor
open) and [#99](https://github.com/Byline-CMS/bylinecms.dev/issues/99) (the collection
API document viewer). Preserved here because the numbers are the evidence behind two
commits and because the method has two traps that are easy to fall into twice.

Files:

- `geometry-probe.js` — instrumentation. Console snippet, or added above `hydrateRoot`
  in `apps/webapp/src/client.tsx` to capture a full page load.
- `ab-driver.js` — repeated-navigation driver and a React-safe keystroke driver.
- `samples.json` — every sample, including the void ones, labelled.

Everything below is from one machine, one Chrome window, and the two documents named in
`samples.json`. No result here is a general performance claim about Byline.

## What the instrument measures

It counts **geometry reads, not forced layouts**. Wrapping `scrollWidth`, `clientWidth`,
`offsetWidth` and friends counts every call, including reads against already-clean
layout, which cost nothing. Only a read with non-trivial duration forced layout. Summed
durations are a proxy for the cost of those reads — not a measure of the browser's
layout time, and silent about what invalidated layout beforehand. A recorded Chrome
Performance trace is the only thing that answers that, and none has been taken yet.

`ms` throughout is navigation-to-double-`requestAnimationFrame`: a proxy for paint,
quantised at about 16.7 ms. Differences smaller than one frame are not resolvable by it,
and subtracting two medians cannot partition browser work between blocking and paint.

## Two traps

**An occluded window reports `document.visibilityState === 'hidden'`.** On macOS a Chrome
window sitting behind the terminal counts. Chrome performs no rendering for such a tab,
so a forced read pays for layout a visible tab would already have done after painting the
server-rendered HTML. Those numbers are inflated by an unknown amount and cannot be
compared with visible-tab numbers or against Chrome's 30 ms violation threshold. Record
`visibilityState` with **every sample**, not once at the start. Background tabs also
clamp `setTimeout` to about a second, so any timing that waits on timers is void too.
Four production hydration samples were lost to this; they are kept in `samples.json`
marked `VOID`.

**`clientWidth` and `scrollWidth` are defined on `Element.prototype`; `offsetWidth` and
friends on `HTMLElement.prototype`.** Wrapping only one of the two silently measures
nothing and reports a misleading zero. Run a positive control — invalidate layout, then
read — before trusting any result.

## Findings

### Tab strip re-measurement (fixed, `d4174418`)

`AdminTabs` keyed its measurement effect on the identity of the `tabs` array, which a
form layout rebuilds on every render. Ten keystrokes in a Title field produced **40
geometry reads (4.9 ms) before the fix and 0 after**.

Paired ten-run measurements show editor *opening* is unchanged by it — 179.2 ms median
before, 183.4 ms after, with the same 19.1 ms of summed read time. The fix addresses
editing, not opening.

### API viewer initial expansion (fixed, `90d714e8`)

Two complete production builds served side by side, same document, viewport and
navigation path, six samples each:

| | `allExpanded` | `level < 2` |
|---|---|---|
| navigation-to-double-rAF, median | 238.0 ms | 99.4 ms |
| largest timed geometry read | ~123 ms | ~6.7 ms |
| long tasks per transition | 140–157 ms, every sample | none observed |
| mounted `.byline-api-viewer` nodes | 4182 | 96 |

Reducing the viewer's initial DOM substantially reduced the measured cost at the
breadcrumb read. The node count is the primary evidence: unlike the timings it depends on
neither paint timing nor tab visibility.

### Where the expensive reads occur

- **Client-side navigation into the editor:** in the tab strip (`tabs.tsx`).
- **Full page load of the editor:** at `breadcrumbs.tsx:63` (`nav.clientWidth` inside
  `compute()`), with the tab strip contributing ~0.
- **Client-side navigation into the API view:** at the same breadcrumbs call site.

Why a given call site absorbs the cost on a given path is **not established**.

### Unexplained

Dev full page loads fall into two regimes — roughly 29 ms of summed read time with 35
geometry reads, and roughly 188 ms with 24. Two samples each; the relative frequency is
unknown and should not be inferred from four samples. This is the most interesting open
lead.

## Next evidence

A Chrome Performance recording of a full page load of the editor:

1. **No CPU throttling** — the point is to characterise the real experience.
2. **Editor tab visible** for the whole recording.
3. **Record through hydration until the editor is usable** (fields interactive, tab strip
   settled), not merely to first paint.
4. **Several hard-reloaded loads.**

Then locate the `Layout` attributed to `breadcrumbs.tsx:63` and read upward: the
preceding `Recalculate Style`, the task that dirtied the DOM, and whether a font or
stylesheet resolved in that window.

The trace should choose among the available responses rather than the other way round.
Candidates include reducing the content mounted initially, isolating layout so a read
does not require the whole document, and changing when the measurement runs. Deferring a
measurement does not by itself imply a visible flash — that depends on the
implementation. A 4× CPU-throttled recording is useful only as a separately labelled
follow-up.
