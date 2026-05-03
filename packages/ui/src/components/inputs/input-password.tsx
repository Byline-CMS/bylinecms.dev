import { useState } from 'react'

import { EyeClosedIcon } from '../../icons/eye-closed-icon.jsx'
import { EyeOpenIcon } from '../../icons/eye-open-icon.jsx'
import { Input } from './input.jsx'
import type { InputProps } from './input.jsx'

export function InputPassword({ ...props }: InputProps) {
  const [visible, setVisible] = useState(false)

  return (
    <Input
      type={visible ? 'text' : 'password'}
      endAdornment={
        visible ? (
          <EyeOpenIcon width="18px" height="18px" onClick={() => setVisible(!visible)} />
        ) : (
          <EyeClosedIcon width="18px" height="18px" onClick={() => setVisible(!visible)} />
        )
      }
      {...props}
    />
  )
}
