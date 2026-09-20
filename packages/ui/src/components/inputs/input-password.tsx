import { useState } from 'react'

import cx from 'clsx'

import { EyeClosedIcon } from '../../icons/eye-closed-icon.jsx'
import { EyeOpenIcon } from '../../icons/eye-open-icon.jsx'
import { Input } from './input.jsx'
import styles from './input-password.module.css'
import type { InputProps } from './input.jsx'

/**
 * `type` and `endAdornment` are the two props this component exists to
 * control, so they are removed from the public surface rather than left
 * to be overridden.
 *
 * They used to be overridable by accident: props were spread AFTER them,
 * so a caller passing the obvious `type="password"` silently defeated the
 * toggle — the icon swapped, the field stayed masked. Omitting them turns
 * that into a compile error instead of a bug someone has to notice.
 */
export interface InputPasswordProps extends Omit<InputProps, 'type' | 'endAdornment'> {
  /** Accessible name for the reveal control while the password is hidden. */
  showPasswordLabel?: string
  /** Accessible name for the reveal control while the password is shown. */
  hidePasswordLabel?: string
}

export function InputPassword({
  showPasswordLabel = 'Show password',
  hidePasswordLabel = 'Hide password',
  ...props
}: InputPasswordProps) {
  const [visible, setVisible] = useState(false)

  return (
    <Input
      // Spread first: `type` below is the whole point of the component and
      // must win over anything a caller passes.
      {...props}
      type={visible ? 'text' : 'password'}
      endAdornment={
        <button
          type="button"
          className={cx('byline-input-password-toggle', styles.toggle)}
          // A real button, not a div: the control has to be reachable by
          // keyboard and announced by a screen reader. The icons are
          // `aria-hidden`, so without a name here the control is silent.
          aria-label={visible ? hidePasswordLabel : showPasswordLabel}
          aria-pressed={visible}
          // Clicking the toggle must not blur the field. Beyond keeping the
          // caret where the user left it, a blur fires the form's validation
          // and the re-render that follows can replace this element between
          // mousedown and mouseup — which loses the click entirely.
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => setVisible((current) => !current)}
        >
          {visible ? (
            <EyeOpenIcon width="18px" height="18px" />
          ) : (
            <EyeClosedIcon width="18px" height="18px" />
          )}
        </button>
      }
    />
  )
}
