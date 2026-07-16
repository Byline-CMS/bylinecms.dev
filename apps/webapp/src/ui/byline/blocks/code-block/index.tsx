'use client'

import type { CodeBlockData } from '@byline/generated-types'
import { Container } from '@byline/ui/react'
import cx from 'classnames'

import { Code } from '@/ui/byline/components/code'
import type { Locale } from '@/i18n/i18n-config'

interface Props {
  id: string
  block: CodeBlockData
  lng: Locale
  constrainedLayout?: boolean
  className?: string
}

export function CodeBlock({
  id,
  block,
  className,
  constrainedLayout,
}: Props): React.JSX.Element | null {
  if (!block.code) return null

  return (
    <Container id={id} className={cx({ 'px-0': constrainedLayout }, className)}>
      <div className="mx-auto max-w-[920px]">
        <Code code={block.code} language={block.language === 'plain' ? null : block.language} />
        {block.caption && (
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">{block.caption}</p>
        )}
      </div>
    </Container>
  )
}
