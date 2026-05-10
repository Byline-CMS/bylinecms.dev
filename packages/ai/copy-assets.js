import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const srcDir = path.join(__dirname, 'src')
const distDir = path.join(__dirname, 'dist')

function copyFiles(src, dest) {
  if (!fs.existsSync(src)) return

  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true })
  }

  const entries = fs.readdirSync(src, { withFileTypes: true })

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name)
    const destPath = path.join(dest, entry.name)

    if (entry.isDirectory()) {
      copyFiles(srcPath, destPath)
    } else {
      const ext = path.extname(entry.name).toLowerCase()
      // Add other extensions if needed
      if (['.css', '.svg', '.png', '.jpg', '.gif', '.scss', '.sass'].includes(ext)) {
        fs.copyFileSync(srcPath, destPath)
      }
    }
  }
}

console.log('Copying assets...')
copyFiles(srcDir, distDir)
console.log('Assets copied.')
