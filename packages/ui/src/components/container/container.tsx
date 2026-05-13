import type React from 'react'

import cx from 'classnames'

import styles from './container.module.css'

type ContainerIntrinsicProps = React.JSX.IntrinsicElements['div']
export interface ContainerProps extends ContainerIntrinsicProps {}

export const Container = function Container({
  ref,
  className,
  children,
  ...rest
}: ContainerProps & {
  ref?: React.RefObject<HTMLDivElement>
}): React.JSX.Element {
  return (
    <div ref={ref} {...rest} className={cx('byline-container', styles.container, className)}>
      {children}
    </div>
  )
}
