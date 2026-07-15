import { DEFAULT_SIGN_IN_PATH, validateRoutePaths } from '../lib/route-config.js'
import type { Phase } from '../types.js'

/**
 * Collects user choices that downstream phases (`deps`, `scaffold`) need
 * to see *before* they plan their work. Runs immediately after preflight
 * so that, e.g., `deps` can skip optional packages tied to an example the
 * user declined.
 *
 * Currently asks:
 *  - `adminPath`: the single URL segment used by route files and runtime config
 *  - `signInPath`: the URL path used by the public sign-in route
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
    const answers = ctx.state.get().answers
    return ctx.state.isComplete('prompts') &&
      answers.adminPath !== undefined &&
      answers.signInPath !== undefined
      ? 'done'
      : 'pending'
  },

  async plan(ctx) {
    const a = ctx.state.get().answers
    const notes: string[] = []
    if (a.adminPath === undefined) notes.push('will ask: admin URL path?')
    else notes.push(`admin path: ${a.adminPath} (already answered)`)
    if (a.signInPath === undefined) notes.push('will ask: sign-in URL path?')
    else notes.push(`sign-in path: ${a.signInPath} (already answered)`)
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

    let adminPath = current.adminPath
    if (adminPath === undefined) {
      adminPath = await ctx.prompter.text({
        message: 'Where should the admin UI be mounted?',
        defaultValue: '/admin',
        placeholder: '/admin',
        validate: (value) => {
          const result = validateRoutePaths(ctx, value, current.signInPath ?? DEFAULT_SIGN_IN_PATH)
          return result.ok ? undefined : result.error
        },
      })
    }

    let signInPath = current.signInPath
    if (signInPath === undefined) {
      signInPath = await ctx.prompter.text({
        message: 'Where should the sign-in page be mounted?',
        defaultValue: DEFAULT_SIGN_IN_PATH,
        placeholder: DEFAULT_SIGN_IN_PATH,
        validate: (value) => {
          const result = validateRoutePaths(ctx, adminPath, value)
          return result.ok ? undefined : result.error
        },
      })
    }

    const routes = validateRoutePaths(ctx, adminPath, signInPath)
    if (!routes.ok) {
      ctx.logger.error(routes.error)
      return { state: 'blocked' }
    }
    ctx.state.patchAnswers({
      adminPath: routes.value.adminPath,
      signInPath: routes.value.signInPath,
    })

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
          'Include the optional markdown → Byline import example script? Adds 6 devDependencies (gray-matter, unified, remark-parse, remark-gfm, mdast-util-to-string, @types/mdast) used only by byline/scripts/import-docs.ts. Copied helper tests are excluded so the host does not need Vitest.',
        defaultValue: false,
      })
    }
    ctx.state.patchAnswers({ importDocs })

    return { state: 'done' }
  },
}
