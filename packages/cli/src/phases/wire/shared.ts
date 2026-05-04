import type { Context } from '../../context.js'

/**
 * Outcome of a single wire sub-edit.
 *
 *   done    — the file changed (or the change is being applied right now in apply()).
 *   skipped — the file already had the wiring; no edit needed.
 *   manual  — the change is too risky to automate (custom code, AST shape we don't
 *             recognise, file diverges from a known canonical) — the user must apply
 *             the printed `snippet` themselves.
 *   blocked — a hard error (file missing, unparseable, etc.) — installer cannot
 *             continue this sub-edit at all.
 *
 * Persisted into `state.wireSubEdits[<key>]` (only `'done' | 'manual' | 'skipped' |
 * 'pending'` — `blocked` collapses to `'pending'` so re-run picks it up).
 */
export type SubEditStatus = 'done' | 'skipped' | 'manual' | 'blocked'

export interface SubEditResult {
  status: SubEditStatus
  /** Human-readable, single line — used in plan() notes and apply() logs. */
  message: string
  /** Set on `manual` to print the exact text the user should paste. */
  snippet?: string
}

export interface SubEdit {
  /** Stable key persisted into state.wireSubEdits. */
  key: string
  /** Title shown in plan/preview. */
  title: string
  /** Idempotent dry-check — no side effects. */
  preview(ctx: Context): Promise<SubEditResult>
  /** Make the edit. May write files. */
  apply(ctx: Context): Promise<SubEditResult>
}
