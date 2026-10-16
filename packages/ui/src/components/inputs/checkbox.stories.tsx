import type React from 'react'
import { useState } from 'react'

import { Checkbox } from './checkbox.js'

export default {
  title: 'Components/Inputs/Checkbox',
  component: Checkbox,
  argTypes: {},
}

export const Default = (): React.JSX.Element => {
  const [checked, setChecked] = useState(false)
  const handleOnClick = (): void => {
    console.log('clicked')
    setChecked(!checked)
  }

  return (
    <>
      <div style={{ maxWidth: '800px', margin: '2rem auto 2rem' }}>
        <h2 style={{ fontSize: '1.25rem', marginBottom: '1rem' }}>Outlined</h2>
        <div
          style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '1rem' }}
        >
          <div style={{ minWidth: 0 }}>
            <Checkbox
              onClick={handleOnClick}
              aria-label="Foo Primary"
              checked={checked}
              id="primary"
              name="primary"
              label="Foo Primary"
            />
          </div>
          <div style={{ minWidth: 0 }}>
            <Checkbox
              intent="secondary"
              onClick={handleOnClick}
              aria-label="Foo Secondary"
              checked={checked}
              id="secondary"
              name="secondary"
              label="Foo Secondary"
            />
          </div>
          <div style={{ minWidth: 0 }}>
            <Checkbox
              intent="noeffect"
              onClick={handleOnClick}
              aria-label="Foo No Effect"
              checked={checked}
              id="noeffect"
              name="noneffect"
              label="Foo No Effect"
            />
          </div>
          <div style={{ minWidth: 0 }}>
            <Checkbox
              intent="success"
              onClick={handleOnClick}
              aria-label="Foo Success"
              checked={checked}
              id="success"
              name="success"
              label="Foo Success"
            />
          </div>
          <div style={{ minWidth: 0 }}>
            <Checkbox
              intent="info"
              onClick={handleOnClick}
              aria-label="Foo Info"
              checked={checked}
              id="info"
              name="info"
              label="Foo Info"
            />
          </div>
          <div style={{ minWidth: 0 }}>
            <Checkbox
              intent="warning"
              onClick={handleOnClick}
              aria-label="Foo Warning"
              checked={checked}
              id="warning"
              name="warning"
              label="Foo Warning"
            />
          </div>
          <div style={{ minWidth: 0 }}>
            <Checkbox
              intent="danger"
              onClick={handleOnClick}
              aria-label="Foo Danger"
              checked={checked}
              id="danger"
              name="danger"
              label="Foo Danger"
            />
          </div>
        </div>
      </div>
      <div style={{ maxWidth: '800px', margin: '0 auto 2rem' }}>
        <h2 style={{ fontSize: '1.25rem', marginBottom: '1rem' }}>Filled</h2>
        <div
          style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '1rem' }}
        >
          <div style={{ minWidth: 0 }}>
            <Checkbox
              onClick={handleOnClick}
              variant="filled"
              aria-label="Foo Primary"
              checked={checked}
              id="primary"
              name="primary"
              label="Foo Primary"
            />
          </div>
          <div style={{ minWidth: 0 }}>
            <Checkbox
              intent="secondary"
              onClick={handleOnClick}
              variant="filled"
              aria-label="Foo Secondary"
              checked={checked}
              id="secondary"
              name="secondary"
              label="Foo Secondary"
            />
          </div>
          <div style={{ minWidth: 0 }}>
            <Checkbox
              intent="noeffect"
              onClick={handleOnClick}
              variant="filled"
              aria-label="Foo No Effect"
              checked={checked}
              id="noeffect"
              name="noneffect"
              label="Foo No Effect"
            />
          </div>
          <div style={{ minWidth: 0 }}>
            <Checkbox
              intent="success"
              onClick={handleOnClick}
              variant="filled"
              aria-label="Foo Success"
              checked={checked}
              id="success"
              name="success"
              label="Foo Success"
            />
          </div>
          <div style={{ minWidth: 0 }}>
            <Checkbox
              intent="info"
              onClick={handleOnClick}
              variant="filled"
              aria-label="Foo Info"
              checked={checked}
              id="info"
              name="info"
              label="Foo Info"
            />
          </div>
          <div style={{ minWidth: 0 }}>
            <Checkbox
              intent="warning"
              onClick={handleOnClick}
              variant="filled"
              aria-label="Foo Warning"
              checked={checked}
              id="warning"
              name="warning"
              label="Foo Warning"
            />
          </div>
          <div style={{ minWidth: 0 }}>
            <Checkbox
              intent="danger"
              onClick={handleOnClick}
              variant="filled"
              aria-label="Foo Danger"
              checked={checked}
              id="danger"
              name="danger"
              label="Foo Danger"
            />
          </div>
        </div>
      </div>
    </>
  )
}

export const Checked = (): React.JSX.Element => {
  const [checked, setChecked] = useState(true)
  const handleOnClick = (): void => {
    setChecked(!checked)
  }
  return (
    <div style={{ maxWidth: '800px', margin: '4rem auto' }}>
      <Checkbox
        aria-label="Foo Checkbox"
        onClick={handleOnClick}
        checked={checked}
        id="foo"
        name="foo"
        label="Foo Checkbox"
      />
    </div>
  )
}

export const Sized = (): React.JSX.Element => {
  const [checked, setChecked] = useState(true)
  const handleOnClick = (): void => {
    setChecked(!checked)
  }
  return (
    <div style={{ maxWidth: '800px', margin: '2rem auto 2rem' }}>
      <h2 style={{ fontSize: '1.25rem', marginBottom: '1rem' }}>Outlined</h2>
      <div
        style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '1rem' }}
      >
        <div style={{ minWidth: 0 }}>
          <Checkbox
            onClick={handleOnClick}
            aria-label="Large Checkbox"
            size="lg"
            checked={checked}
            id="large"
            name="large"
            label="Large Checkbox"
          />
        </div>
        <div style={{ minWidth: 0 }}>
          <Checkbox
            onClick={handleOnClick}
            aria-label="Medium Checkbox"
            size="md"
            checked={checked}
            id="medium"
            name="medium"
            label="Medium Checkbox"
          />
        </div>
        <div style={{ minWidth: 0 }}>
          <Checkbox
            onClick={handleOnClick}
            aria-label="Small Checkbox"
            size="sm"
            checked={checked}
            id="small"
            name="small"
            label="Small Checkbox"
          />
        </div>
      </div>
    </div>
  )
}

export const Disabled = (): React.JSX.Element => {
  const [checked, setChecked] = useState(true)
  const handleOnClick = (): void => {
    setChecked(!checked)
  }
  return (
    <div style={{ maxWidth: '800px', margin: '4rem auto' }}>
      <Checkbox
        aria-label="Foo Checkbox"
        onClick={handleOnClick}
        checked={checked}
        disabled
        id="foo"
        name="foo"
        label="Foo Checkbox"
      />
    </div>
  )
}
