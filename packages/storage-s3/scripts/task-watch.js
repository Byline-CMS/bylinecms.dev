/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import chokidar from 'chokidar'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Define source and output paths
const srcDir = path.join(__dirname, '..', 'src')
const outputDir = path.join(__dirname, '..', 'dist')

const runTypeScriptCompilation = () => {
  return new Promise((resolve, reject) => {
    console.log('🔧 Running TypeScript compilation...')
    const tsc = spawn('tsc', ['-p', 'tsconfig.json'], {
      stdio: 'inherit',
      cwd: path.join(__dirname, '..'),
    })

    tsc.on('close', (code) => {
      if (code === 0) {
        console.log('✅ TypeScript compilation complete')
        resolve()
      } else {
        console.error(`❌ TypeScript compilation failed with code ${code}`)
        reject(new Error(`TypeScript compilation failed with code ${code}`))
      }
    })
  })
}

const run = async () => {
  try {
    console.log('🚀 Building Byline storage-s3...')

    // Ensure output directory exists
    fs.mkdirSync(outputDir, { recursive: true })

    await runTypeScriptCompilation()

    console.log('✅ Byline storage-s3 build complete.')
  } catch (error) {
    console.error('Error during Byline storage-s3 build:', error)
  }
}

const watcher = chokidar.watch(srcDir, {
  persistent: true,
  ignoreInitial: true,
})

watcher
  .on('add', (filePath) => {
    console.log(`📂 File ${filePath} has been added`)
    run()
  })
  .on('change', (filePath) => {
    console.log(`📂 File ${filePath} has been changed`)
    run()
  })
  .on('unlink', (filePath) => {
    console.log(`📂 File ${filePath} has been removed`)
    run()
  })

// Initial run to bundle existing files
run()

console.log(`👁️ Watching for Byline storage-s3 changes in ${srcDir}...`)
