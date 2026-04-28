import cx from 'classnames'
import { jsx as _jsx } from 'react/jsx-runtime'
import './warning-icon.css'
export function WarningIcon({ className, ...rest }) {
  return _jsx('div', {
    className: cx('warning-icon', className),
    ...rest,
    children: _jsx('svg', {
      focusable: 'false',
      'aria-hidden': 'true',
      viewBox: '0 0 24 24',
      children: _jsx('path', {
        d: 'M12 5.99L19.53 19H4.47L12 5.99M12 2L1 21h22L12 2zm1 14h-2v2h2v-2zm0-6h-2v4h2v-4z',
      }),
    }),
  })
}
