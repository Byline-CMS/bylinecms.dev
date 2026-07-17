'use client'

import { useEffect, useState } from 'react'

import type { FaqBlockData } from '@byline/generated-types'
import { Accordion, Container } from '@byline/ui/react'
import cx from 'classnames'

import { LexicalRichText } from '@/ui/byline/components/richtext-lexical'
import type { Locale } from '@/i18n/i18n-config'

interface Props {
  id: string
  block: FaqBlockData
  lng: Locale
  constrainedLayout?: boolean
  className?: string
}

/**
 * Reference renderer for the FAQ block (see byline/blocks/faq-block.ts) —
 * an accordion of question/answer pairs. A `?q=<item id>` query parameter
 * deep-links to (and opens) a specific question.
 */
export function FAQBlock({
  id,
  block,
  lng,
  className,
  constrainedLayout,
}: Props): React.JSX.Element | null {
  const faq = block.faq
  const [active, setActive] = useState<string[]>([])

  useEffect(() => {
    const params = new URL(window.location.href).searchParams
    const q = params.get('q')
    if (q != null && q.length > 0) {
      setActive([q])
    }
  }, []) // Run only once on load

  if (faq == null || faq.length === 0) {
    return null
  }

  return (
    <Container id={id} className={cx('py-4', { 'px-0': constrainedLayout }, className)}>
      <div className="mx-auto max-w-[920px]">
        <Accordion.Root
          render={<ul className="pl-4 !my-0" />}
          multiple
          value={active}
          onValueChange={(value) => setActive(value as string[])}
        >
          {faq.map((item) => {
            const answer = item.answer as Record<string, any> | undefined
            return (
              <Accordion.Item
                key={item._id}
                value={item._id}
                render={
                  <li
                    style={{ listStyleType: '"Q."', paddingInlineStart: '1ch' }}
                    className="faq-item"
                  />
                }
              >
                {/* Header (a real heading) wraps a native-button Trigger —
                    the structure Base UI expects. */}
                <Accordion.Header
                  render={
                    // biome-ignore lint/a11y/useHeadingContent: the heading is a render target — Accordion.Header injects the Trigger (with the question text) as its content
                    <h2 className="faq-question !my-0 !mb-2 text-[1em] font-normal" />
                  }
                >
                  <Accordion.Trigger className="text-left leading-7">
                    {item.question}
                  </Accordion.Trigger>
                </Accordion.Header>
                <Accordion.Panel>
                  <div className={cx('faq-content text-lg border rounded p-4 mb-6 [&_p]:mt-0')}>
                    <LexicalRichText lng={lng} nodes={answer?.root?.children} />
                  </div>
                </Accordion.Panel>
              </Accordion.Item>
            )
          })}
        </Accordion.Root>
      </div>
    </Container>
  )
}
