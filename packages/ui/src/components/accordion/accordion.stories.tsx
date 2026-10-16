import type { Meta, StoryObj } from '@storybook/react-vite'

import { ChevronDownIcon } from '../../icons/chevron-down-icon.js'
import { Accordion as AccordionComponent } from './accordion.js'

const meta: Meta = {
  /* 👇 The title prop is optional.
   * See https://storybook.js.org/docs/react/configure/overview#configure-story-loading
   * to learn how to generate automatic titles
   */
  title: 'Components',
  component: AccordionComponent.Root,
}

export default meta

type Story = StoryObj<typeof AccordionComponent.Root>

/**
 * NOTE: Accordions are very much context specific in terms of styling
 * and so we apply very little styling to the default accordion component.
 * Below is an example of a custom (albeit basic) styled accordion for demo
 * purposes.
 */
export const Accordion: Story = {
  args: {
    defaultValue: ['item-1'],
    className: 'accordion-root',
  },
  render: (args) => (
    <div style={{ maxWidth: '600px', margin: '2rem auto' }}>
      <style>
        {`
      .accordion-root {
        border: 1px solid var(--gray-100);
        border-radius: 6px;
        padding: 12px 6px;
        width: 300px;
        background-color: white;
        box-shadow: var(--shadow-md);
      }
  
      .accordion-header {
        border-radius: 6px;
        padding: 12px;
      }

      .accordion-header:hover {
        background-color: var(--gray-25);
      }

      .accordion-chevron {
        transition: transform 300ms cubic-bezier(0.87, 0, 0.13, 1);
      }

      .accordion-trigger[data-panel-open] ~ .accordion-chevron {
        transform: rotate(180deg);
      }

      .accordion-panel {
        padding: 0 12px;
      }

      .dark .accordion-root {
        border: 1px solid var(--gray-600);
        background-color: var(--canvas-700);
      }

      .dark .accordion-header:hover {
        background-color: var(--canvas-600);
      }

      
    `}
      </style>
      <AccordionComponent.Root {...args}>
        <nav>
          <AccordionComponent.Item value="item-1" className="accordion-item">
            <AccordionComponent.Header className="accordion-header">
              <AccordionComponent.Trigger className="accordion-trigger">
                Is it accessible?
              </AccordionComponent.Trigger>
              <ChevronDownIcon className="accordion-chevron" />
            </AccordionComponent.Header>
            <AccordionComponent.Panel className="accordion-panel">
              <p>Yes. It adheres to the WAI-ARIA design pattern.</p>
            </AccordionComponent.Panel>
          </AccordionComponent.Item>

          <AccordionComponent.Item value="item-2">
            <AccordionComponent.Header className="accordion-header">
              <AccordionComponent.Trigger className="accordion-trigger">
                Is it unstyled?
              </AccordionComponent.Trigger>
              <ChevronDownIcon className="accordion-chevron" />
            </AccordionComponent.Header>
            <AccordionComponent.Panel className="accordion-panel">
              <ul>
                <li>Submenu Item One</li>
                <li>Submenu Item Two</li>
                <li>Submenu Item Three</li>
              </ul>
            </AccordionComponent.Panel>
          </AccordionComponent.Item>

          <AccordionComponent.Item value="item-3">
            <AccordionComponent.Header className="accordion-header">
              <AccordionComponent.Trigger className="accordion-trigger">
                Can it be animated?
              </AccordionComponent.Trigger>
              <ChevronDownIcon className="accordion-chevron" />
            </AccordionComponent.Header>
            <AccordionComponent.Panel className="accordion-panel">
              <p> Yes! You can animate the Accordion with CSS or JavaScript.</p>
            </AccordionComponent.Panel>
          </AccordionComponent.Item>
        </nav>
      </AccordionComponent.Root>
    </div>
  ),
}
