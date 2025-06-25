/**
 * Byline CMS
 *
 * Copyright © 2025 Anthony Bouch and contributors.
 *
 * This file is part of Byline CMS.
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as
 * published by the Free Software Foundation, either version 3 of the
 * License, or (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program. If not, see <https://www.gnu.org/licenses/>.
 */

import type React from 'react'

import type { Meta } from '@storybook/react-vite'

import { Timeline as TimelineComponent } from './timeline.js'

const meta: Meta = {
  /* 👇 The title prop is optional.
   * See https://storybook.js.org/docs/react/configure/overview#configure-story-loading
   * to learn how to generate automatic titles
   */
  title: 'Components',
  component: TimelineComponent,
}

export default meta

export const Timeline = (): React.JSX.Element => (
  <div
    style={{
      maxWidth: '400px',
      marginBottom: '24px',
      display: 'flex',
      justifyContent: 'center',
    }}
  >
    <TimelineComponent>
      <TimelineComponent.Root>
        <TimelineComponent.Item>
          <TimelineComponent.Icon />
          <TimelineComponent.Heading>Website Launch</TimelineComponent.Heading>
          <TimelineComponent.Date>September 2023</TimelineComponent.Date>
          <TimelineComponent.Content>Some cool content here....</TimelineComponent.Content>
        </TimelineComponent.Item>
        <TimelineComponent.Item>
          <TimelineComponent.Icon />
          <TimelineComponent.Heading>Website Launch</TimelineComponent.Heading>
          <TimelineComponent.Date>September 2023</TimelineComponent.Date>
          <TimelineComponent.Content>Some cool content here....</TimelineComponent.Content>
        </TimelineComponent.Item>
        <TimelineComponent.Item>
          <TimelineComponent.Icon />
          <TimelineComponent.Heading>Website Launch</TimelineComponent.Heading>
          <TimelineComponent.Date>September 2023</TimelineComponent.Date>
          <TimelineComponent.Content>Some cool content here....</TimelineComponent.Content>
        </TimelineComponent.Item>
      </TimelineComponent.Root>
    </TimelineComponent>
  </div>
)
