import type React from 'react'

import type { Meta } from '@storybook/react-vite'

import { Table as TableComponent } from './table.js'

const meta: Meta = {
  /* 👇 The title prop is optional.
   * See https://storybook.js.org/docs/react/configure/overview#configure-story-loading
   * to learn how to generate automatic titles
   */
  title: 'Components',
  component: TableComponent,
}

export default meta

export const Table = (): React.JSX.Element => {
  return (
    <div style={{ maxWidth: '960px', margin: '2rem auto' }}>
      <TableComponent.Container>
        <TableComponent>
          <TableComponent.Header>
            <TableComponent.Row>
              <TableComponent.HeadingCell scope="col">
                <span>Check</span>
              </TableComponent.HeadingCell>
              <TableComponent.HeadingCell scope="col">
                <p>Heading 1</p>
              </TableComponent.HeadingCell>
              <TableComponent.HeadingCell scope="col">
                <p>Heading 2</p>
              </TableComponent.HeadingCell>
              <TableComponent.HeadingCell scope="col">
                <p>Heading 3</p>
              </TableComponent.HeadingCell>
            </TableComponent.Row>
          </TableComponent.Header>

          <TableComponent.Body>
            <TableComponent.Row>
              <TableComponent.Cell>
                <span>Check</span>
              </TableComponent.Cell>
              <TableComponent.Cell>1</TableComponent.Cell>
              <TableComponent.Cell>2</TableComponent.Cell>
              <TableComponent.Cell>3</TableComponent.Cell>
            </TableComponent.Row>
            <TableComponent.Row>
              <TableComponent.Cell>
                <span>Check</span>
              </TableComponent.Cell>
              <TableComponent.Cell>1</TableComponent.Cell>
              <TableComponent.Cell>2</TableComponent.Cell>
              <TableComponent.Cell>3</TableComponent.Cell>
            </TableComponent.Row>
            <TableComponent.Row>
              <TableComponent.Cell>
                <span>Check</span>
              </TableComponent.Cell>
              <TableComponent.Cell>1</TableComponent.Cell>
              <TableComponent.Cell>2</TableComponent.Cell>
              <TableComponent.Cell>3</TableComponent.Cell>
            </TableComponent.Row>
            <TableComponent.Row>
              <TableComponent.Cell>
                <span>Check</span>
              </TableComponent.Cell>
              <TableComponent.Cell>1</TableComponent.Cell>
              <TableComponent.Cell>2</TableComponent.Cell>
              <TableComponent.Cell>3</TableComponent.Cell>
            </TableComponent.Row>
          </TableComponent.Body>
          <TableComponent.Footer>
            <TableComponent.Row>
              <TableComponent.HeadingCell scope="col">
                <span>Check</span>
              </TableComponent.HeadingCell>
              <TableComponent.HeadingCell scope="col">
                <p>Heading 1</p>
              </TableComponent.HeadingCell>
              <TableComponent.HeadingCell scope="col">
                <p>Heading 2</p>
              </TableComponent.HeadingCell>
              <TableComponent.HeadingCell scope="col">
                <p>Heading 3</p>
              </TableComponent.HeadingCell>
            </TableComponent.Row>
          </TableComponent.Footer>
        </TableComponent>
      </TableComponent.Container>
    </div>
  )
}
