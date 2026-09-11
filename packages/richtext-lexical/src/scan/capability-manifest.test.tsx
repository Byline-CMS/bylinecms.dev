import { describe, expect, it } from 'vitest'

import { builtInExtensions } from '../field/config/built-in-extension-names'
import { defaultClientEditorConfig } from '../field/config/default-extensions'
import { buildManifest, capabilitiesFor } from './capability-manifest'
import { scanDocument } from './scan-documents'

function configWithout(...names: string[]) {
  const extensions = defaultClientEditorConfig.extensions?.clone()
  for (const name of names) extensions.remove(name)
  return { ...defaultClientEditorConfig, extensions }
}

describe('capabilitiesFor', () => {
  it('reports what the default configuration accepts', () => {
    const caps = capabilitiesFor('pages', 'body', defaultClientEditorConfig)
    for (const type of ['root', 'paragraph', 'text', 'heading', 'list', 'table', 'link']) {
      expect(caps.supportedTypes, type).toContain(type)
    }
  })

  it('omits a removed extensions node types', () => {
    const caps = capabilitiesFor('pages', 'title', configWithout(builtInExtensions.Heading))
    expect(caps.supportedTypes).not.toContain('heading')
    expect(caps.supportedTypes).toContain('paragraph')
  })

  it('includes nodes contributed through dependencies, not just declared ones', () => {
    // Table and list nodes arrive from @lexical/table and @lexical/list as
    // dependencies of the Byline wrappers, so a manifest derived by
    // walking declared `nodes` would miss them.
    const caps = capabilitiesFor('pages', 'body', defaultClientEditorConfig)
    expect(caps.supportedTypes).toContain('table')
    expect(caps.supportedTypes).toContain('tablecell')
    expect(caps.supportedTypes).toContain('listitem')
  })

  it('includes the always-on core nodes', () => {
    const caps = capabilitiesFor(
      'pages',
      'body',
      configWithout(...Object.values(builtInExtensions))
    )
    expect(caps.supportedTypes).toContain('mark')
    expect(caps.supportedTypes).toContain('overflow')
  })

  it('feeds the scanner, which then agrees with the editor', () => {
    const caps = capabilitiesFor('publications', 'title', configWithout(builtInExtensions.Heading))
    // biome-ignore lint/suspicious/noExplicitAny: serialized fixture
    const saved: any = {
      root: {
        children: [
          {
            children: [],
            direction: null,
            format: '',
            indent: 0,
            type: 'heading',
            version: 1,
            tag: 'h1',
          },
        ],
        direction: null,
        format: '',
        indent: 0,
        type: 'root',
        version: 1,
      },
    }
    const finding = scanDocument(saved, caps, { documentId: 'doc-1', versionId: 'ver-1' })
    expect(finding?.adaptedTypes).toEqual(['heading'])
  })
})

describe('buildManifest', () => {
  it('stamps when it was generated', () => {
    const manifest = buildManifest([capabilitiesFor('pages', 'body', defaultClientEditorConfig)])
    expect(manifest.fields).toHaveLength(1)
    expect(Number.isNaN(Date.parse(manifest.generatedAt))).toBe(false)
  })
})
