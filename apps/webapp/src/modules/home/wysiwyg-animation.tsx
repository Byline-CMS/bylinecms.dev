import { useEffect, useState } from 'react'

import { useTranslations } from '@/i18n/client/translations-provider'

export function WYSIWYGAnimation() {
  const { t } = useTranslations('frontend')
  const [currentText, setCurrentText] = useState('')
  const [currentIndex, setCurrentIndex] = useState(0)

  const fullText = t('editorDemo')

  useEffect(() => {
    if (currentIndex < fullText.length) {
      const timeout = setTimeout(() => {
        setCurrentText(fullText.slice(0, currentIndex + 1))
        setCurrentIndex(currentIndex + 1)
      }, 50)
      return () => clearTimeout(timeout)
    }
    // Reset animation after a pause
    const resetTimeout = setTimeout(() => {
      setCurrentText('')
      setCurrentIndex(0)
    }, 3000)
    return () => clearTimeout(resetTimeout)
  }, [currentIndex, fullText])

  return (
    <div className="bg-white dark:bg-canvas-800 rounded-lg shadow-2xl border border-gray-200 dark:border-gray-700 overflow-hidden">
      {/* Editor Toolbar */}
      <div className="bg-gray-50 dark:bg-canvas-800 border-b border-gray-200 dark:border-canvas-700 p-3">
        <div className="flex items-center space-x-2">
          <div className="flex space-x-1">
            <button
              type="button"
              className="w-8 h-8 bg-gray-200 dark:bg-canvas-700 rounded hover:bg-gray-300 dark:hover:bg-gray-500 flex items-center justify-center"
            >
              <span className="text-sm font-bold">B</span>
            </button>
            <button
              type="button"
              className="w-8 h-8 bg-gray-200 dark:bg-canvas-700 rounded hover:bg-gray-300 dark:hover:bg-gray-500 flex items-center justify-center"
            >
              <span className="text-sm italic">I</span>
            </button>
            <button
              type="button"
              className="w-8 h-8 bg-gray-200 dark:bg-canvas-700 rounded hover:bg-gray-300 dark:hover:bg-gray-500 flex items-center justify-center"
            >
              <span className="text-sm underline">U</span>
            </button>
          </div>
          <div className="w-px h-6 bg-gray-300 dark:bg-canvas-700"></div>
          <div className="flex space-x-1">
            <button
              type="button"
              className="w-8 h-8 bg-gray-200 dark:bg-canvas-700 rounded hover:bg-gray-300 dark:hover:bg-gray-500 flex items-center justify-center"
            >
              <span className="text-xs">H1</span>
            </button>
            <button
              type="button"
              className="w-8 h-8 bg-gray-200 dark:bg-canvas-700 rounded hover:bg-gray-300 dark:hover:bg-gray-500 flex items-center justify-center"
            >
              <span className="text-xs">H2</span>
            </button>
          </div>
          <div className="w-px h-6 bg-gray-300 dark:bg-gray-700"></div>
          <button
            type="button"
            className="px-3 py-1 bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 rounded text-sm font-medium"
          >
            ✨ AI Assist
          </button>
        </div>
      </div>

      {/* Editor Content */}
      <div className="p-6 min-h-[300px] bg-white dark:bg-canvas-800">
        <div className="prose dark:prose-invert max-w-none">
          <div className="text-2xl font-bold mb-4 text-gray-900 dark:text-white">
            {t('editorHeading')}
          </div>
          <div className="text-gray-700 dark:text-gray-300 leading-relaxed">
            {currentText}
            <span className="animate-pulse">|</span>
          </div>
        </div>
      </div>
    </div>
  )
}
