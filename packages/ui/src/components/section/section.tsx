import type React from 'react'

import cx from 'classnames'

import styles from './section.module.css'

type SectionIntrinsicProps = React.JSX.IntrinsicElements['section']
export interface SectionProps extends SectionIntrinsicProps {}

export const Section = function Section({
  ref,
  className,
  children,
  ...rest
}: SectionProps & {
  ref?: React.RefObject<HTMLElement>
}): React.JSX.Element {
  return (
    <section className={cx('byline-section', styles.section, className)} ref={ref} {...rest}>
      {children}
    </section>
  )
}
