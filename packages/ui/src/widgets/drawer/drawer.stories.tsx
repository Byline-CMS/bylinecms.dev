import React from 'react'

import { Button } from '../../components/button/button.js'
import { IconButton } from '../../components/button/icon-button.js'
import { CloseIcon } from '../../icons/close-icon.js'
import { DatePicker } from '../datepicker/datepicker.js'
import { Drawer } from './drawer.js'

export default {
  title: 'Widgets/Drawer',
  component: Drawer,
  argTypes: {},
}

export const Default = (): React.JSX.Element => {
  const [isOpen, setIsOpen] = React.useState(false)

  return (
    <>
      <Button
        onClick={() => {
          setIsOpen(true)
        }}
      >
        Open Drawer
      </Button>
      <Drawer
        id="first-drawer"
        closeOnOverlayClick={true}
        isOpen={isOpen}
        onDismiss={() => setIsOpen(false)}
      >
        <Drawer.Container>
          <Drawer.TopActions>
            <button type="button" tabIndex={0} className="sr-only">
              no action
            </button>
            <IconButton
              aria-label="Close"
              size="xs"
              onClick={() => {
                setIsOpen(false)
              }}
            >
              <CloseIcon width="14px" height="14px" />
            </IconButton>
          </Drawer.TopActions>
          <Drawer.Header
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: '1rem',
            }}
          >
            <h2>Drawer Actions Here</h2>
          </Drawer.Header>
          <Drawer.Content>
            <p>Drawer content here...</p>
          </Drawer.Content>
        </Drawer.Container>
      </Drawer>
    </>
  )
}

export const TopOffset = (): React.JSX.Element => {
  const [isOpen, setIsOpen] = React.useState(false)

  return (
    <>
      <Button
        onClick={() => {
          setIsOpen(true)
        }}
      >
        Open Drawer
      </Button>
      <Drawer
        id="top-offset-drawer"
        topOffset="60px"
        closeOnOverlayClick={false}
        isOpen={isOpen}
        onDismiss={() => setIsOpen(false)}
      >
        <Drawer.Container>
          <Drawer.TopActions>
            <button type="button" tabIndex={0} className="sr-only">
              no action
            </button>
            <IconButton
              aria-label="Close"
              size="xs"
              onClick={() => {
                setIsOpen(false)
              }}
            >
              <CloseIcon width="14px" height="14px" />
            </IconButton>
          </Drawer.TopActions>
          <Drawer.Header
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: '1rem',
            }}
          >
            <h2>Drawer Actions Here</h2>
          </Drawer.Header>
          <Drawer.Content>
            <p>Drawer content here...</p>
          </Drawer.Content>
        </Drawer.Container>
      </Drawer>
    </>
  )
}

export const Wide = (): React.JSX.Element => {
  const [isOpen, setIsOpen] = React.useState(false)

  return (
    <>
      <Button
        onClick={() => {
          setIsOpen(true)
        }}
      >
        Open Drawer
      </Button>
      <Drawer
        id="first-drawer"
        closeOnOverlayClick={false}
        isOpen={isOpen}
        width="wide"
        onDismiss={() => setIsOpen(false)}
      >
        <Drawer.Container>
          <Drawer.TopActions>
            <button type="button" tabIndex={0} className="sr-only">
              no action
            </button>
            <IconButton
              aria-label="Close"
              size="xs"
              onClick={() => {
                setIsOpen(false)
              }}
            >
              <CloseIcon width="14px" height="14px" svgClassName="white-icon" />
            </IconButton>
          </Drawer.TopActions>
          <Drawer.Header
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: '1rem',
            }}
          >
            <h2>Drawer Actions Here</h2>
          </Drawer.Header>
          <Drawer.Content>
            <p>Drawer content here...</p>
            <div style={{ maxWidth: '300px', marginTop: '20px', margin: '0 auto' }}>
              <DatePicker
                id="datepicker-1"
                name="datepicker-1"
                label="Select Date"
                required
                initialValue={new Date()}
                onDateChange={(date) => {
                  console.log('Selected date:', date)
                }}
              />
            </div>
          </Drawer.Content>
        </Drawer.Container>
      </Drawer>
    </>
  )
}

export const Nested = (): React.JSX.Element => {
  const [isOpen1, setIsOpen1] = React.useState(false)
  const [isOpen2, setIsOpen2] = React.useState(false)

  return (
    <>
      <Button
        onClick={() => {
          setIsOpen1(true)
        }}
      >
        Open Drawer 1
      </Button>
      <Drawer
        id="first-drawer"
        width="medium"
        closeOnOverlayClick={true}
        isOpen={isOpen1}
        onDismiss={() => setIsOpen1(false)}
      >
        <Drawer.Container>
          <Drawer.TopActions>
            <button type="button" tabIndex={0} className="sr-only">
              no action
            </button>
            <IconButton
              aria-label="Close"
              size="xs"
              onClick={() => {
                setIsOpen1(false)
              }}
            >
              <CloseIcon width="14px" height="14px" svgClassName="white-icon" />
            </IconButton>
          </Drawer.TopActions>
          <Drawer.Header
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: '1rem',
            }}
          >
            <h2>Drawer 1</h2>
          </Drawer.Header>
          <Drawer.Content>
            <p>Drawer 1 actions here...</p>
            <Button
              onClick={() => {
                setIsOpen2(true)
              }}
            >
              Open Drawer 2
            </Button>
            <Drawer
              id="second-drawer"
              width="medium"
              closeOnOverlayClick={true}
              isOpen={isOpen2}
              onDismiss={() => setIsOpen2(false)}
            >
              <Drawer.Container>
                <Drawer.TopActions>
                  <button type="button" tabIndex={0} className="sr-only">
                    no action
                  </button>
                  <IconButton
                    aria-label="Close"
                    size="xs"
                    onClick={() => {
                      setIsOpen2(false)
                    }}
                  >
                    <CloseIcon width="14px" height="14px" svgClassName="white-icon" />
                  </IconButton>
                </Drawer.TopActions>
                <Drawer.Header
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    marginBottom: '1rem',
                  }}
                >
                  <h2>Drawer 2</h2>
                </Drawer.Header>
                <Drawer.Content>
                  <p>Drawer content here...</p>
                </Drawer.Content>
              </Drawer.Container>
            </Drawer>
          </Drawer.Content>
        </Drawer.Container>
      </Drawer>
    </>
  )
}
