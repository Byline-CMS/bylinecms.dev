import { useRender } from '@base-ui/react/use-render'
import cx from 'classnames'

import styles from './badge.module.css'
import type { Intent } from '../@types/shared'

export type BadgeProps = useRender.ComponentProps<'div'> & {
  children: React.ReactNode
  intent?: Intent
  className?: string
  ref?: React.Ref<HTMLDivElement>
}

export const Badge = ({
  className,
  intent = 'primary',
  children,
  render,
  ref,
  ...rest
}: BadgeProps): React.JSX.Element => {
  const element = useRender({
    defaultTagName: 'div',
    render,
    ref,
    props: {
      ...rest,
      className: cx(
        'byline-badge',
        `byline-badge-${intent}`,
        styles.badge,
        styles[intent],
        className
      ),
      children,
    },
  })

  return element
}

Badge.displayName = 'Badge'
