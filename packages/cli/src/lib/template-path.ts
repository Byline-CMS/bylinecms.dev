/** Normalize a template-relative path independently of the host platform. */
export function toPosixTemplatePath(path: string): string {
  return path.replaceAll('\\', '/')
}

/** Source comparison used only for recognizing exact canonical predecessors. */
export function normalizeTemplateSource(source: string): string {
  return source.replaceAll('\r\n', '\n').trimEnd()
}
