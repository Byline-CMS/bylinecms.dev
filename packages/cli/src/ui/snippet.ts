import pc from 'picocolors'

export function renderSnippet(title: string, body: string, lang = ''): string {
  const header = pc.dim(`--- ${title}${lang ? ` (${lang})` : ''} ---`)
  const footer = pc.dim('---')
  return `${header}\n${body}\n${footer}`
}
