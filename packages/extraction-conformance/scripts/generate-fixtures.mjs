#!/usr/bin/env node
/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

// Writes the conformance fixtures, using hand-written PDF syntax and no dependencies.
// The output is committed, and a test asserts that it matches this script.
//
//   sentinel.pdf   three born-digital pages, with one unique sentinel per page
//   truncated.pdf  the first half of sentinel.pdf, with no cross-reference table
//   corrupt.pdf    a PDF header followed by bytes with no PDF structure to recover
//
// Usage: node scripts/generate-fixtures.mjs [output-directory]

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const PAGE_COUNT = 3

function buildSentinelPdf() {
  const firstPageObject = 4
  const pageObject = (page) => firstPageObject + (page - 1) * 2
  const kids = Array.from({ length: PAGE_COUNT }, (_, i) => `${pageObject(i + 1)} 0 R`).join(' ')

  const objects = new Map([
    [1, '<< /Type /Catalog /Pages 2 0 R >>'],
    [2, `<< /Type /Pages /Kids [${kids}] /Count ${PAGE_COUNT} >>`],
    [3, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'],
  ])
  for (let page = 1; page <= PAGE_COUNT; page += 1) {
    const content = `BT /F1 12 Tf 72 720 Td (BYLINE-SENTINEL-PAGE-${page}) Tj ET`
    objects.set(
      pageObject(page),
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] ' +
        `/Resources << /Font << /F1 3 0 R >> >> /Contents ${pageObject(page) + 1} 0 R >>`
    )
    objects.set(
      pageObject(page) + 1,
      `<< /Length ${content.length} >>\nstream\n${content}\nendstream`
    )
  }

  let pdf = '%PDF-1.4\n'
  const offsets = []
  const ids = [...objects.keys()].sort((a, b) => a - b)
  for (const id of ids) {
    offsets[id] = pdf.length
    pdf += `${id} 0 obj\n${objects.get(id)}\nendobj\n`
  }
  const xref = pdf.length
  pdf += `xref\n0 ${ids.length + 1}\n0000000000 65535 f \n`
  for (const id of ids) pdf += `${String(offsets[id]).padStart(10, '0')} 00000 n \n`
  pdf += `trailer\n<< /Size ${ids.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(pdf, 'latin1')
}

function buildCorruptPdf() {
  const header = Buffer.from('%PDF-1.4\n', 'latin1')
  const noise = Buffer.alloc(512)
  // A fixed sequence, so the file is reproducible. It holds no PDF objects.
  let state = 0x2f
  for (let i = 0; i < noise.length; i += 1) {
    state = (state * 73 + 41) % 251
    noise[i] = state
  }
  return Buffer.concat([header, noise])
}

export function buildFixtures() {
  const sentinel = buildSentinelPdf()
  return {
    'sentinel.pdf': sentinel,
    'truncated.pdf': sentinel.subarray(0, Math.floor(sentinel.length / 2)),
    'corrupt.pdf': buildCorruptPdf(),
  }
}

const script = fileURLToPath(import.meta.url)
if (process.argv[1] !== undefined && resolve(process.argv[1]) === script) {
  const output = process.argv[2] ?? join(dirname(script), '..', 'fixtures')
  mkdirSync(output, { recursive: true })
  for (const [name, bytes] of Object.entries(buildFixtures())) {
    writeFileSync(join(output, name), bytes)
  }
}
