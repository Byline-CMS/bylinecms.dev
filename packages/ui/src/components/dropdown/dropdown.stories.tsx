import type { Meta, StoryObj } from '@storybook/react-vite'

import { SignOutIcon } from '../../icons/sign-out-icon.js'
import { UserIcon } from '../../icons/user-icon.js'
import { Button } from '../button/button.js'
import { Dropdown as DropdownComponent } from './dropdown.js'

const meta: Meta = {
  /* 👇 The title prop is optional.
   * See https://storybook.js.org/docs/react/configure/overview#configure-story-loading
   * to learn how to generate automatic titles
   */
  title: 'Components/Dropdown',
  component: DropdownComponent.Root,
}

export default meta

type Story = StoryObj<typeof DropdownComponent.Root>

export const Dropdown: Story = {
  args: {
    modal: false,
  },
  render: (args) => {
    return (
      <>
        <style>
          {`
          .dropdown-item-content {
            display: flex;
            align-items: center;
          }

          .dropdown-item-content-icon {
            display: inline-block;
            width: 28px;
          }

          .dropdown-item-content-text {
            text-align: left;
            display: inline-block;
            width: 100%;
            flex: 1;
          }

        `}
        </style>
        <div
          style={{
            maxWidth: '400px',
            margin: '2rem 0 24px',
            display: 'flex',
            justifyContent: 'center',
          }}
        >
          <DropdownComponent.Root {...args}>
            <DropdownComponent.Trigger render={<Button size="sm" variant="filled" />}>
              +
            </DropdownComponent.Trigger>

            <DropdownComponent.Portal>
              <DropdownComponent.Content align="end" data-side="top" sideOffset={10}>
                <DropdownComponent.Item>
                  <div className="dropdown-item-content">
                    <span className="dropdown-item-content-icon">
                      <UserIcon width="22px" height="22px" />
                    </span>
                    <span className="dropdown-item-content-text">Account</span>
                  </div>
                </DropdownComponent.Item>
                <DropdownComponent.Item>
                  <div className="dropdown-item-content">
                    <span className="dropdown-item-content-icon" />
                    <span className="dropdown-item-content-text">Menu Item 2</span>
                  </div>
                </DropdownComponent.Item>
                <DropdownComponent.Separator />
                <DropdownComponent.Item>
                  <div className="dropdown-item-content">
                    <span className="dropdown-item-content-icon">
                      <SignOutIcon />
                    </span>
                    <span className="dropdown-item-content-text">
                      <button
                        type="button"
                        style={{
                          textAlign: 'left',
                          display: 'inline-block',
                          width: '100%',
                          flex: 1,
                          lineHeight: 1,
                          color: 'var(--text)',
                        }}
                      >
                        Sign Out
                      </button>
                    </span>
                  </div>
                </DropdownComponent.Item>
              </DropdownComponent.Content>
            </DropdownComponent.Portal>
          </DropdownComponent.Root>
        </div>
      </>
    )
  },
}
