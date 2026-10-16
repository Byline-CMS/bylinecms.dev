import type React from 'react'

import { LoaderEllipsis } from './ellipses.js'
import { LoaderRing } from './ring.js'
import { LoaderSpinner } from './spinner.js'

interface LoaderProps {
  loader: React.JSX.Element
  label: string
}

function Loader({ loader, label }: LoaderProps): React.JSX.Element {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.5rem' }}>
      {loader}
      <span style={{ fontSize: '0.875rem', color: 'var(--muted)' }}>{label}</span>
    </div>
  )
}

const LoaderDemo = (): React.JSX.Element => (
  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1.25rem' }}>
    <Loader loader={<LoaderRing size={48} />} label="Ring" />
    <Loader loader={<LoaderEllipsis size={48} />} label="Ellipsis" />
    <Loader loader={<LoaderSpinner size={48} />} label="Spinner" />
  </div>
)

export default {
  title: 'Loaders/All',
  component: LoaderDemo,
  argTypes: {},
}

export const Default = (): React.JSX.Element => {
  return (
    <div style={{ marginBottom: '1.5rem' }}>
      <div style={{ maxWidth: 700 }}>
        <LoaderDemo />
      </div>
    </div>
  )
}

const sizes: (number | string)[] = [24, 36, 48, 64, 80]

export const Sizes = (): React.JSX.Element => {
  return (
    <div style={{ maxWidth: '800px', margin: '1.5rem auto' }}>
      <div style={{ maxWidth: '800px', display: 'flex', flexDirection: 'column', gap: '2.5rem' }}>
        <div>
          <h3 style={{ marginBottom: '1rem', fontSize: '1.125rem', fontWeight: 600 }}>Ring</h3>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: '2.5rem' }}>
            {sizes.map((size) => (
              <Loader
                key={String(size)}
                loader={<LoaderRing size={size} />}
                label={`${size}${typeof size === 'number' ? 'px' : ''}`}
              />
            ))}
          </div>
        </div>
        <div>
          <h3 style={{ marginBottom: '1rem', fontSize: '1.125rem', fontWeight: 600 }}>Ellipsis</h3>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: '2.5rem' }}>
            {sizes.map((size) => (
              <Loader
                key={String(size)}
                loader={<LoaderEllipsis size={size} />}
                label={`${size}${typeof size === 'number' ? 'px' : ''}`}
              />
            ))}
          </div>
        </div>
        <div>
          <h3 style={{ marginBottom: '1rem', fontSize: '1.125rem', fontWeight: 600 }}>Spinner</h3>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: '2.5rem' }}>
            {sizes.map((size) => (
              <Loader
                key={String(size)}
                loader={<LoaderSpinner size={size} />}
                label={`${size}${typeof size === 'number' ? 'px' : ''}`}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

const colors = [
  { value: 'var(--theme-500)', label: 'Theme' },
  { value: '#e53e3e', label: '#e53e3e' },
  { value: '#38a169', label: '#38a169' },
  { value: '#3182ce', label: '#3182ce' },
  { value: '#d69e2e', label: '#d69e2e' },
]

export const Colors = (): React.JSX.Element => {
  return (
    <div style={{ maxWidth: '800px', margin: '1.5rem auto' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '2.5rem' }}>
        <div>
          <h3 style={{ marginBottom: '1rem', fontSize: '1.125rem', fontWeight: 600 }}>Ring</h3>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: '2.5rem' }}>
            {colors.map(({ value, label }) => (
              <Loader key={label} loader={<LoaderRing size={48} color={value} />} label={label} />
            ))}
          </div>
        </div>
        <div>
          <h3 style={{ marginBottom: '1rem', fontSize: '1.125rem', fontWeight: 600 }}>Ellipsis</h3>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: '2.5rem' }}>
            {colors.map(({ value, label }) => (
              <Loader
                key={label}
                loader={<LoaderEllipsis size={48} color={value} />}
                label={label}
              />
            ))}
          </div>
        </div>
        <div>
          <h3 style={{ marginBottom: '1rem', fontSize: '1.125rem', fontWeight: 600 }}>Spinner</h3>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: '2.5rem' }}>
            {colors.map(({ value, label }) => (
              <Loader
                key={label}
                loader={<LoaderSpinner size={48} color={value} />}
                label={label}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

const stringSizes: (number | string)[] = ['1.5rem', '2rem', '3rem', '4rem']

export const StringSizes = (): React.JSX.Element => {
  return (
    <div style={{ maxWidth: '800px', margin: '1.5rem auto' }}>
      <div style={{ maxWidth: '800px', display: 'flex', flexDirection: 'column', gap: '2.5rem' }}>
        <div>
          <h3 style={{ marginBottom: '1rem', fontSize: '1.125rem', fontWeight: 600 }}>
            Ring (rem units)
          </h3>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: '2.5rem' }}>
            {stringSizes.map((size) => (
              <Loader key={String(size)} loader={<LoaderRing size={size} />} label={String(size)} />
            ))}
          </div>
        </div>
        <div>
          <h3 style={{ marginBottom: '1rem', fontSize: '1.125rem', fontWeight: 600 }}>
            Ellipsis (rem units)
          </h3>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: '2.5rem' }}>
            {stringSizes.map((size) => (
              <Loader
                key={String(size)}
                loader={<LoaderEllipsis size={size} />}
                label={String(size)}
              />
            ))}
          </div>
        </div>
        <div>
          <h3 style={{ marginBottom: '1rem', fontSize: '1.125rem', fontWeight: 600 }}>
            Spinner (rem units)
          </h3>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: '2.5rem' }}>
            {stringSizes.map((size) => (
              <Loader
                key={String(size)}
                loader={<LoaderSpinner size={size} />}
                label={String(size)}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
