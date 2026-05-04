import { createPatch } from 'diff'
import pc from 'picocolors'

export function renderDiff(
  filePath: string,
  before: string,
  after: string,
  opts: { color?: boolean } = {}
): string {
  const color = opts.color !== false
  const patch = createPatch(filePath, before, after, '', '', { context: 3 })

  if (!color) return patch

  return patch
    .split('\n')
    .map((line) => {
      if (line.startsWith('+++') || line.startsWith('---')) return pc.bold(line)
      if (line.startsWith('@@')) return pc.cyan(line)
      if (line.startsWith('+')) return pc.green(line)
      if (line.startsWith('-')) return pc.red(line)
      return line
    })
    .join('\n')
}
