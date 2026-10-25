import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { relative, resolve } from 'node:path'
import { test } from 'node:test'

import postcss from 'postcss'

import { BYLINE_LAYER_ORDER, bylineLayerOrder } from '../src/css-layers.ts'

const root = resolve(import.meta.dirname, '..')
const files = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(dir, entry.name)
    return entry.isDirectory() ? files(path) : [path]
  })
const statements = postcss.parse(BYLINE_LAYER_ORDER).nodes
const params = statements[0].params
const componentParams = statements[1].params
const packageRoots = ['ui', 'admin', 'host-tanstack-start', 'richtext-lexical', 'ai', 'i18n'].map(
  (name) => resolve(root, '..', name)
)
const sourceSheets = () =>
  packageRoots.flatMap((dir) => files(resolve(dir, 'src'))).filter((f) => f.endsWith('.css'))
const expected = params.split(',').map((s) => s.trim())
function firstLayerOrder(css) {
  const names = []
  for (const node of postcss.parse(css).nodes) {
    if (node.type !== 'atrule' || node.name !== 'layer') continue
    for (const name of node.params.split(',').map((s) => s.trim()))
      if (!names.includes(name.split('.')[0])) names.push(name.split('.')[0])
  }
  return names.slice(0, expected.length)
}

test('every package stylesheet reserves the complete order before rules or imports', () => {
  const sheets = sourceSheets()
  assert.ok(sheets.length > 0)
  for (const file of sheets) {
    const first = postcss.parse(readFileSync(file, 'utf8')).nodes.find((n) => n.type !== 'comment')
    assert.equal(first?.type, 'atrule', file)
    assert.equal(first?.name, 'layer', file)
    assert.equal(first?.nodes, undefined, file)
    assert.equal(first?.params.replace(/\s/g, ''), params.replace(/\s/g, ''), file)
    const second = postcss
      .parse(readFileSync(file, 'utf8'))
      .nodes.filter((n) => n.type !== 'comment')[1]
    assert.equal(second?.params.replace(/\s/g, ''), componentParams.replace(/\s/g, ''), file)
  }
})

test('Package ordinary declarations are layered and do not use important', () => {
  const issues = []
  for (const file of sourceSheets()) {
    postcss.parse(readFileSync(file, 'utf8')).walkDecls((d) => {
      let layered = false,
        descriptor = false
      for (let p = d.parent; p; p = p.parent) {
        if (p.type !== 'atrule') continue
        if (p.name === 'layer' && p.params.trim()) layered = true
        if (/^(font-face|property|counter-style)$|(?:^|-)keyframes$/.test(p.name)) descriptor = true
      }
      if ((!layered && !descriptor) || d.important)
        issues.push(`${relative(root, file)}:${d.source.start.line} ${d.prop}`)
    })
  }
  assert.deepEqual(issues, [])
})

test('PostCSS reserves the order before imports, partial preludes and nested rules', async () => {
  for (const css of [
    '@import "host.css"; .host { color: red }',
    '@layer components { @scope (.host) { .box { padding: 1rem } } }',
    '@layer utilities, overrides; @layer overrides { .brand { color: red } }',
  ]) {
    const { css: output } = await postcss([bylineLayerOrder()]).process(css, { from: undefined })
    assert.deepEqual(firstLayerOrder(output), expected)
    const repeated = await postcss([bylineLayerOrder()]).process(output, { from: undefined })
    assert.deepEqual(firstLayerOrder(repeated.css), expected)
  }
})

test('host overrides and kit utilities both precede Tailwind utilities', () => {
  assert.ok(expected.indexOf('overrides') > expected.indexOf('byline-components'))
  assert.ok(expected.indexOf('byline-utilities') > expected.indexOf('overrides'))
  assert.equal(expected.at(-1), 'utilities')
})

test('the example keeps both early-head and pre-hash integration', () => {
  const example = resolve(root, '../../apps/webapp')
  assert.match(
    readFileSync(resolve(example, 'src/routes/__root.tsx'), 'utf8'),
    /<style>\{BYLINE_LAYER_ORDER\}<\/style>/
  )
  assert.match(
    readFileSync(resolve(example, 'vite.config.ts'), 'utf8'),
    /postcss: \{ plugins: \[bylineLayerOrder\(\)\] \}/
  )
})

test('published export has JS and declarations without a React runtime import', {
  skip: process.env.CSS_BUILD_CHECK !== '1',
}, async () => {
  const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'))
  const entry = manifest.publishConfig.exports['./css-layers']
  assert.ok(readFileSync(resolve(root, entry.types), 'utf8').includes('BYLINE_LAYER_ORDER'))
  const js = readFileSync(resolve(root, entry.import), 'utf8')
  assert.doesNotMatch(js, /(?:import|from)\s*['"](?:react|postcss)/)
  const shipped = await import(resolve(root, entry.import))
  assert.equal(shipped.BYLINE_LAYER_ORDER, BYLINE_LAYER_ORDER)
  const { css } = await postcss([shipped.bylineLayerOrder()]).process('.box { width: 1px }', {
    from: undefined,
  })
  assert.deepEqual(firstLayerOrder(css), expected)
})

test('every emitted package stylesheet preserves first-appearance order after bundling', {
  skip: process.env.CSS_BUILD_CHECK !== '1',
}, () => {
  const sheets = packageRoots
    .flatMap((dir) => files(resolve(dir, 'dist')))
    .filter((f) => f.endsWith('.css'))
  assert.ok(sheets.length > 0)
  for (const file of sheets)
    assert.deepEqual(firstLayerOrder(readFileSync(file, 'utf8')), expected, file)
})

test('component declarations live in the explicit primitives or CMS sublayers', () => {
  const issues = []
  for (const file of sourceSheets()) {
    postcss.parse(readFileSync(file, 'utf8')).walkDecls((d) => {
      const layers = []
      for (let p = d.parent; p; p = p.parent) {
        if (p.type === 'atrule' && p.name === 'layer') layers.unshift(p.params.trim())
      }
      if (layers.join('.') === 'byline-components') issues.push(`${file}:${d.source.start.line}`)
    })
  }
  assert.deepEqual(issues, [])
})

test('runtime important exceptions remain explicit and bounded', () => {
  // CodeMirror owns generated selection/highlight styles. This exception does
  // not grant an ordinary-utility guarantee on its generated internal nodes.
  const allowed = [
    {
      file: '../admin/src/fields/code/code-editor.tsx',
      declaration: "backgroundColor: 'var(--byline-code-selection) !important'",
      reason: 'Keep the Byline selection token above CodeMirror injected selection rules',
    },
  ]
  const seen = []
  for (const dir of packageRoots)
    for (const file of files(resolve(dir, 'src')).filter((f) => /\.[cm]?[jt]sx?$/.test(f))) {
      const source = readFileSync(file, 'utf8')
      for (const line of source
        .split('\n')
        .filter((line) => /!important/.test(line) && !/^\s*(?:\/\/|\*)/.test(line))) {
        const entry = allowed.find(
          (item) => resolve(root, item.file) === file && line.includes(item.declaration)
        )
        assert.ok(
          entry?.reason,
          `Undocumented runtime important declaration: ${file}: ${line.trim()}`
        )
        seen.push(entry.file)
      }
    }
  assert.deepEqual(seen.sort(), allowed.map((item) => item.file).sort())
})

test('emitted CSS preserves primitive-before-CMS sublayer order', {
  skip: process.env.CSS_BUILD_CHECK !== '1',
}, () => {
  for (const dir of packageRoots)
    for (const file of files(resolve(dir, 'dist')).filter((f) => f.endsWith('.css'))) {
      const names = []
      const visit = (nodes, parent = '') => {
        for (const node of nodes) {
          if (node.type !== 'atrule' || node.name !== 'layer') continue
          for (const raw of node.params.split(',')) {
            const name = parent ? `${parent}.${raw.trim()}` : raw.trim()
            if (name.startsWith('byline-components.') && !names.includes(name)) names.push(name)
            if (node.nodes) visit(node.nodes, name)
          }
        }
      }
      visit(postcss.parse(readFileSync(file, 'utf8')).nodes)
      assert.deepEqual(
        names.slice(0, 2),
        ['byline-components.primitives', 'byline-components.cms'],
        file
      )
    }
})

test('the example keeps public typography overrides outside the CMS', () => {
  const example = resolve(root, '../../apps/webapp')
  const css = postcss.parse(readFileSync(resolve(example, 'src/ui/styles/overrides.css'), 'utf8'))
  css.walkDecls((declaration) => {
    let scoped = false
    for (let parent = declaration.parent; parent; parent = parent.parent) {
      if (
        parent.type === 'atrule' &&
        parent.name === 'scope' &&
        parent.params === '(:root[data-theme-context="public"])'
      )
        scoped = true
    }
    assert.ok(scoped, `Public override leaks into the CMS: ${declaration.prop}`)
  })
  assert.match(
    readFileSync(resolve(example, 'src/routes/__root.tsx'), 'utf8'),
    /data-theme-context=\{themeContext\}/
  )
})

test('apply directives cannot bypass declaration layering', () => {
  for (const file of sourceSheets()) {
    postcss.parse(readFileSync(file, 'utf8')).walkAtRules('apply', (node) => {
      let layered = false
      for (let parent = node.parent; parent; parent = parent.parent) {
        if (parent.type === 'atrule' && parent.name === 'layer' && parent.params.trim())
          layered = true
      }
      assert.ok(layered, `Unlayered @apply in ${file}:${node.source.start.line}`)
      assert.doesNotMatch(node.params, /!important\b/, file)
    })
  }
})
