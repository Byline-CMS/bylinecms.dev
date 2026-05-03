export function getPortalRoot(): false | HTMLElement {
  return typeof window !== 'undefined' && (document.getElementById('portal-root') ?? document.body)
}
