import React from 'react'

import type { Meta, StoryObj } from '@storybook/react-vite'

import { EventPager } from './event-pager.js'

const meta: Meta<typeof EventPager> = {
  /* 👇 The title prop is optional.
   * See https://storybook.js.org/docs/react/configure/overview#configure-story-loading
   * to learn how to generate automatic titles
   */
  title: 'Components/Pager',
  component: EventPager,
}

export default meta

const DefaultPager = (): React.JSX.Element => {
  const [page, setPage] = React.useState(1)

  const handlePageChange = (_event: any, number: number): void => {
    setPage(number)
  }

  return (
    <>
      <style>
        {`
        .event-pager {
          margin-bottom: 1rem;
        }
      `}
      </style>
      <div style={{ margin: '2rem 0', maxWidth: '600px' }}>
        <p style={{ marginBottom: '1rem' }}>Stateful Pagers: Current page: {page}</p>
        <EventPager
          page={page}
          count={24}
          className="event-pager"
          onChange={handlePageChange}
          showFirstButton
          showLastButton
          componentName="pager1"
          aria-label="Pager 1"
        />
        <EventPager
          page={page}
          count={24}
          className="event-pager"
          onChange={handlePageChange}
          componentName="pager2"
          aria-label="Pager 2"
        />
        <EventPager
          page={page}
          count={24}
          className="event-pager"
          onChange={handlePageChange}
          componentName="pager3"
          hideNextButton
          hidePrevButton
          aria-label="Pager 3"
        />
      </div>
    </>
  )
}

const ClassicPager = (): React.JSX.Element => {
  const [page, setPage] = React.useState(1)

  const handlePageChange = (_event: any, number: number): void => {
    setPage(number)
  }

  return (
    <>
      <style>
        {`
        .event-pager {
          margin-bottom: 1rem;
        }
      `}
      </style>
      <div style={{ margin: '2rem 0', maxWidth: '600px' }}>
        <p style={{ marginBottom: '1rem' }}>Stateful Pagers: Current page: {page}</p>
        <EventPager
          variant="classic"
          className="event-pager"
          page={page}
          count={24}
          onChange={handlePageChange}
          showFirstButton
          showLastButton
          componentName="pager1"
          aria-label="Pager 1"
        />
        <EventPager
          variant="classic"
          className="event-pager"
          page={page}
          count={24}
          onChange={handlePageChange}
          componentName="pager2"
          aria-label="Pager 2"
        />
        <EventPager
          variant="classic"
          className="event-pager"
          page={page}
          count={24}
          onChange={handlePageChange}
          componentName="pager3"
          hideNextButton
          hidePrevButton
          aria-label="Pager 3"
        />
      </div>
    </>
  )
}

const DashboardPager = (): React.JSX.Element => {
  const [page, setPage] = React.useState(1)

  const handlePageChange = (_event: any, number: number): void => {
    setPage(number)
  }

  return (
    <>
      <style>
        {`
        .event-pager {
          margin-bottom: 1rem;
        }
      `}
      </style>
      <div style={{ margin: '2rem 0', maxWidth: '600px' }}>
        <p style={{ marginBottom: '1rem' }}>Stateful Pagers: Current page: {page}</p>
        <EventPager
          variant="dashboard"
          className="event-pager"
          page={page}
          count={24}
          onChange={handlePageChange}
          showFirstButton
          showLastButton
          componentName="pager1"
          aria-label="Pager 1"
        />
        <EventPager
          variant="dashboard"
          className="event-pager"
          page={page}
          count={24}
          onChange={handlePageChange}
          componentName="pager2"
          aria-label="Pager 2"
        />
        <EventPager
          variant="dashboard"
          className="event-pager"
          page={page}
          count={24}
          onChange={handlePageChange}
          componentName="pager3"
          hideNextButton
          hidePrevButton
          aria-label="Pager 3"
        />
      </div>
    </>
  )
}

type Story = StoryObj<typeof EventPager>

export const Default: Story = {
  render: () => <DefaultPager />,
}

export const Classic: Story = {
  render: () => <ClassicPager />,
}

export const Dashboard: Story = {
  render: () => <DashboardPager />,
}
