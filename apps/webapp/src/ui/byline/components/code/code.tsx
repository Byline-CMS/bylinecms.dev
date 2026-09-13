'use client'

import { CopyButton } from '@byline/ui/react'
/* eslint-disable no-param-reassign */
import cx from 'clsx'
import { Highlight } from 'prism-react-renderer'

import styles from './code.module.css'
import { codeTheme } from './theme'

type CodeIntrinsicProps = React.JSX.IntrinsicElements['pre']
interface CodeProps extends CodeIntrinsicProps {
  className?: string
  title?: string
  code: string
  language?: string | null
}

export function Code({ code, className, language }: CodeProps): React.JSX.Element {
  // Prism calls `.toLowerCase()` on the language prop, so any null/empty
  // value (e.g. legacy nodes without a `language` field) would crash the
  // tree. Default to TypeScript — matches the importer default.
  const resolvedLanguage = language != null && language.length > 0 ? language : 'typescript'
  return (
    <Highlight theme={codeTheme} code={code} language={resolvedLanguage}>
      {({ style, tokens, getLineProps, getTokenProps }) => (
        <div
          className={cx(
            styles.root,
            'code group min-w-0 overflow-hidden rounded border relative mb-4 mt-4'
          )}
        >
          <CopyButton
            variant="outlined"
            intent="primary"
            className={styles.copyButton}
            containerClassName="absolute top-2 right-2 invisible group-hover:visible group-focus-within:visible"
            svgClassName={styles.copyIcon}
            text={code}
          />
          <pre
            style={style}
            className={cx(styles.scroller, 'm-0 py-5 px-4 rounded-none', className)}
          >
            <code className="not-prose">
              {tokens.map((line, i) => {
                const lineProps = getLineProps({ line, key: i })
                return (
                  <div {...lineProps} key={i} className="leading-5">
                    {/* <span className="-ml-2 mr-3">{i + 1}</span> */}
                    {line.map((token, key) => (
                      <span key={key} {...getTokenProps({ token })} />
                    ))}
                  </div>
                )
              })}
            </code>
          </pre>
        </div>
      )}
    </Highlight>
  )
}
