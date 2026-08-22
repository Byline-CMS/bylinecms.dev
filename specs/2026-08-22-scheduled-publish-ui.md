# Scheduled publication — editor interface design

Date: 2026-08-22
Status: implemented on `feat/scheduled-publish-ui`
Companions:

- `specs/2026-08-22-scheduled-publish.md` — the lifecycle, storage and authorization design this
  interface presents. Nothing in that contract changed.
- `specs/2026-08-22-scheduler.md` — the recurring-task runner that executes a due schedule.

## What this covers

How scheduled publication is presented in the document editor and in the cross-collection queue,
and why each state is placed and weighted the way it is. The lifecycle, authorization, API,
storage, scheduler and transaction contracts are unchanged; this is a presentation layer over
them.

## The problem with the approved baseline

The baseline put every state in one block inside the form's sticky status bar. That bar is built
for three short metadata labels — status, last modified, created — at `0.8rem`, and it stays
pinned as the editor scrolls. Scheduling asked it to carry considerably more:

- With nothing scheduled, a filled `info` button sat beside Save and Publish, competing with the
  form's two primary actions for an operation that is used rarely.
- With something scheduled, a summary line, an explanatory sentence, a bounded error string and a
  row of actions all landed inside the same bar. The overdue state grew it to four lines.

A second problem was structural rather than visual: the control never rendered at all. `FormRenderer`
copied a hand-maintained list of props down to `FormContent`, and the four scheduled-publication
props were declared on `FormRendererProps` but missing from that list. They were accepted from
callers and silently dropped, with no type error, because they are valid props on the outer
component. Fixed first, by forwarding the whole prop object so the class of bug cannot recur.

## Placement

The states differ in how much of the editor's attention they deserve, so they are placed
separately rather than stacked into one block.

**Actions live in the document-actions menu.** `Schedule`, `Reschedule`, `Confirm schedule` and
`Cancel schedule` appear in the `⋮` menu beside the other document-level operations, gated on the
derived state so only the applicable ones are drawn. Scheduling is a deliberate, occasional act;
it does not need standing real estate next to Save. The menu entry uses the short label
`Schedule` — the menu supplies the "this document" context that the modal's title and submit
button have to spell out for themselves.

**An armed schedule joins the status line.** It renders inside the status cell, directly after the
status value and in the success colour, so the row reads `Status: Draft — Scheduled for Aug 25,
2026, 10:26 PM (Asia/Bangkok)`. An armed schedule states where the document is headed, which
continues what Status says about it; filing it beside Created would have made it a timestamp,
which it is not. It is the one cell reporting something pending rather than something already
true, and the colour is what says so at a glance.

**Everything else escalates to a notice.** `needs_reconfirm`, overdue and failing schedules render
as a non-dismissible `Alert` directly below the status bar, carrying their own Confirm /
Reschedule / Cancel actions. Three things follow from that placement:

- The suspension notice outlives the toast that announced it. The brief requires the durable
  `needs_reconfirm` state to stay discoverable after the toast is gone, and `close={false}` is
  exactly that.
- The bounded error and the retry count have somewhere to sit at full width without deforming a
  bar that has to stay compact while pinned.
- The status line and the notice never say the same thing twice: the cell renders only for
  `armed`, and the notice only for the exceptional states.

The notice is wrapped in a named `region` landmark rather than a live region. The toast already
announces the change assertively when it happens; announcing it a second time helps nobody. What
the notice needs is to stay *findable* afterwards, which is what a landmark gives.

## Making the row wrap

Placing a fourth fact on the metadata row exposed that it could not wrap. Every cell sets
`min-width: 0` so it can ellipsize, which works while the row holds three short facts and fails
once a scheduled instant with its IANA zone joins them — the row began shaving every cell at once,
producing `Status: D…` at 1280px and cutting the zone to `(Asia/Ba…`. The zone is the one thing
the cell exists to name.

The row now wraps instead of truncating, and the schedule takes its own line while the row is
stacked, so the status value is never the thing abbreviated. Where the phrase does share a line
and runs to two, the cell aligns to the top so `Status: Draft` sits level with its first line.

## State model

`deriveScheduledPublicationState` is the single place the branching lives. It takes the server's
schedule record, the operations the host has wired for this actor, and an injected `now`, and
returns the kind, the tone, whether the state is exceptional, and which of the four actions apply.

`now` is injected rather than read from the clock so the armed → overdue boundary is testable and
so a single render pass cannot disagree with itself. The queue passes one clock reading for the
whole render and uses the same function, so a row and the document it links to can never disagree
about whether a schedule has gone overdue.

Two combinations are worth calling out, both covered by tests:

- A `needs_reconfirm` schedule whose instant has also passed still reads as *suspended*, not
  overdue — the suspension is why it did not publish, not the clock. The elapsed instant stays
  available to the notice as `isPastDue`.
- A reported `lastError` raises the tone to `danger` regardless of kind, because it is the only
  signal that automatic publication is actively failing rather than merely pending.

Missing handlers mean missing abilities: the server decides, and the editor never draws an action
it cannot complete. An ineligible document — published, single-status workflow, invalid transition,
or an actor lacking either ability — gets no scheduling entries in the menu at all.

## Time and daylight saving

Times are entered with the shared `DatePicker` in its combined date-and-time mode, so scheduling
looks and behaves like the DateTime field, and displayed with the IANA zone named beside them
everywhere: on the status line, in the notice, in the modal, and in every queue row.

The picker reports its selection twice. `onDateChange` gives a `Date`, which is an instant, and the
instant is built with `setHours` — so on the two days a year the clocks change it is not the time
that was picked. A spring-forward 02:30 arrives as 03:30; an ambiguous autumn 01:30 silently
resolves to the earlier of its two instants. Both are exactly the cases that must be refused or
disambiguated, so the modal reads the wall time instead, via the additive `onWallTimeChange`
callback added to the picker for this purpose. The wall time travels as text to
`resolveScheduledPublicationWallTime`, which is the only thing permitted to turn it into an
instant. That resolver is unchanged.

Both messages name the wall time they are talking about. Having normalized the selection, the
picker's own field displays 03:30 for a 02:30 that does not exist — so a message saying "that
local time does not exist" appears to be rejecting the time on screen. It now reads `Mar 14, 2027,
02:30 does not exist — the clocks change that day.` The overlap's offset chooser labels its two
options `Earlier` and `Later` alongside the offset, because which side of a transition a bare
`UTC-04:00` falls on is not something an editor should have to work out.

## Unsaved changes

Scheduling, rescheduling and re-confirming all authorize a specific reviewed version, so each is
blocked while the form is dirty: the existing "save first" prompt fires instead of the modal
opening. Cancelling is deliberately exempt — withdrawing a schedule says nothing about content.

## Queue

The queue keeps its operational surface and reads faster:

- Rows derive their state with the same function the editor uses.
- State is a badge, matching how status reads elsewhere in the admin.
- Each publication time names its zone.
- The state filter is labelled, the authorizer hint moved out of the input's help slot so all
  three controls share a baseline, and the pager separated from the filters — run together they
  read as a third filter control.
- Authorizer ids are monospaced, since the column exists so an operator can compare an id against
  one they hold.

Per-row path resolution still costs one query per displayed row. That is unchanged and remains out
of scope: it affects this specialist queue only, and the response contract was not otherwise being
changed.

## Shared-package changes

Two changes landed in `@byline/ui`, both also ported to `@infonomic/uikit`:

- `DatePicker` gained the optional `onWallTimeChange` callback described above, and now seeds its
  held clock from the incoming date rather than a fixed `08:00` — without which picking a
  different day on a picker opened at 17:56 silently moved the value to 08:00, and the reported
  wall time would have inherited that.
- The datepicker popover's `z-index` moved from Base UI's `Popup`, which computes to
  `position: static` where a z-index is inert, onto the `Positioner`, which is the absolutely
  positioned element. Without it the calendar rendered behind any positioned ancestor — most
  visibly behind a `Modal`, which is where the schedule picker lives.

## Known gaps

- `Modal` builds on Base UI's `Dialog`, which handles focus trapping and focus return, but the
  dialog has no accessible name because `Modal.Header` does not wire `aria-labelledby` to its
  title. That affects every admin modal, not just this one, and is left for a separate change.
- `packages/admin/src/forms/path-widget.test.tsx` has never run: the package's Vitest config
  matches `*.test.node.ts` only, so no `.tsx` test in this package executes.
