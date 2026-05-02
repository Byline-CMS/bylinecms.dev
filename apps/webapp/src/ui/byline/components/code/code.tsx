'use client'

import { CopyButton } from '@infonomic/uikit/react'
/* eslint-disable no-param-reassign */
import cx from 'classnames'
import { Highlight, themes } from 'prism-react-renderer'

type CodeIntrinsicProps = React.JSX.IntrinsicElements['pre']
interface CodeProps extends CodeIntrinsicProps {
  className?: string
  title?: string
  code: string
  language?: string
}

export function Code({ code, className, language = 'jsx' }: CodeProps): React.JSX.Element {
  return (
    <Highlight theme={themes.oneDark} code={code} language={language}>
      {({ tokens, getLineProps, getTokenProps }) => (
        <div className="code scroller group overflow-y-auto rounded border border-theme-600 relative">
          <CopyButton
            variant="outlined"
            intent="primary"
            className="bg-gray-900 hover:bg-gray-800/50"
            containerClassName="dark absolute top-2 right-2 invisible group-hover:visible"
            svgClassName="fill-gray-200 dark:fill-gray-200"
            text={code}
          />
          <pre
            className={cx('m-0 py-5 px-4 rounded-none bg-gray-900 dark:bg-gray-950/80', className)}
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
