import fs from 'fs'
import path from 'path'

// --- Configuration ---
// Directories to recursively scan
const directoriesToScan = [
  './apps/admin/src',
  // Add other directories here
]

// File extensions to target
const fileExtensions = ['.js', '.jsx', '.ts', '.tsx']

// The copyright notice to add
const copyrightNotice = `/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 * 
 * Copyright (c) Infonomic Company Limited
 */`

// --- Script ---

/**
 * Recursively walks a directory and applies the copyright notice to matching files.
 * @param {string} dirPath The directory path to start from.
 */
function walkDir(dirPath) {
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name)
      if (entry.isDirectory()) {
        walkDir(fullPath)
      } else if (entry.isFile() && fileExtensions.includes(path.extname(fullPath))) {
        processFile(fullPath)
      }
    }
  } catch (error) {
    console.error(`Error reading directory ${dirPath}:`, error)
  }
}

/**
 * Adds the copyright notice to a single file.
 * @param {string} filePath The path to the file to process.
 */
function processFile(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf8')

    if (content.includes('Copyright © 2025 Anthony Bouch')) {
      console.log(`Skipping (copyright already exists): ${filePath}`)
      return
    }

    const useClientRegex = /^(?:\s*)('|")use client('|");?\s*\n?/
    const match = content.match(useClientRegex)

    let newContent
    const noticeWithSpacing = copyrightNotice + '\n\n'

    if (match) {
      const useClientDirective = match[0]
      const restOfContent = content.substring(useClientDirective.length)
      newContent = useClientDirective + noticeWithSpacing + restOfContent
      console.log(`Updating (with 'use client'): ${filePath}`)
    } else {
      newContent = noticeWithSpacing + content
      console.log(`Updating: ${filePath}`)
    }

    fs.writeFileSync(filePath, newContent, 'utf8')
  } catch (error) {
    console.error(`Error processing file ${filePath}:`, error)
  }
}

/**
 * Main function to start the process.
 */
function main() {
  console.log('Starting copyright notice script...')
  directoriesToScan.forEach((dir) => {
    const fullPath = path.resolve(dir)
    if (fs.existsSync(fullPath)) {
      walkDir(fullPath)
    } else {
      console.warn(`Directory not found, skipping: ${fullPath}`)
    }
  })
  console.log('Script finished.')
}

// Run the script
main()
