import type { Phase } from '../types.js'

/**
 * Collects user choices that downstream phases (`deps`, `scaffold`) need
 * to see *before* they plan their work. Runs immediately after preflight
 * so that, e.g., `deps` can skip optional packages tied to an example the
 * user declined.
 *
 * Currently asks:
 *  - `examples`: include the example collections/blocks/fields overlay
 *  - `importDocs`: include the markdown → Byline import example script
 *    (`byline/scripts/import-docs.ts` plus `scripts/lib/*`) and its
 *    devDependency stack (gray-matter, unified, remark-*, @types/mdast).
 *    Only asked when `examples` is yes; defaults to no — the production
 *    app never imports these and most users won't need them.
 */
export const promptsPhase: Phase = {
  id: 'prompts',
  title: 'Prompts — collect example/opt-in choices',
  defaultMode: 'auto',

  async detect(ctx) {
    return ctx.state.isComplete('prompts') ? 'done' : 'pending'
  },

  async plan(ctx) {
    const a = ctx.state.get().answers
    const notes: string[] = []
    if (a.examples === undefined) notes.push('will ask: include example collections/blocks/fields?')
    else notes.push(`examples: ${a.examples ? 'yes' : 'no'} (already answered)`)

    if (a.examples === false) {
      notes.push('importDocs: skipped (examples=no)')
    } else if (a.importDocs === undefined) {
      notes.push('will ask: include markdown → Byline import example script?')
    } else {
      notes.push(`importDocs: ${a.importDocs ? 'yes' : 'no'} (already answered)`)
    }
    return { writes: [], commands: [], notes }
  },

  async apply(_plan, ctx) {
    const current = ctx.state.get().answers

    let examples = current.examples
    if (examples === undefined) {
      examples = await ctx.prompter.confirm({
        message: 'Include the example collections, blocks, and fields?',
        defaultValue: true,
      })
      ctx.state.patchAnswers({ examples })
    }

    let importDocs = current.importDocs
    if (!examples) {
      importDocs = false
    } else if (importDocs === undefined) {
      importDocs = await ctx.prompter.confirm({
        message:
          'Include the optional markdown → Byline import example script? Adds 5 devDependencies (gray-matter, unified, remark-parse, remark-gfm, @types/mdast) used only by byline/scripts/import-docs.ts. The other example script (regenerate-media.ts) has no extra dependencies and is included with examples regardless.',
        defaultValue: false,
      })
    }
    ctx.state.patchAnswers({ importDocs })

    return { state: 'done' }
  },
}
