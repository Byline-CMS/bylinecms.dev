/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type { DocumentPublishScheduleInfo } from '@byline/client'
import type { DocumentPublishSchedule } from '@byline/core'

/** Remove sweep-owned fencing credentials before a schedule crosses a transport boundary. */
export function omitScheduleExecutionState(
  schedule: DocumentPublishScheduleInfo | DocumentPublishSchedule
): DocumentPublishScheduleInfo {
  const {
    executionToken: _executionToken,
    executionExpiresAt: _executionExpiresAt,
    ...editorialSchedule
  } = schedule as DocumentPublishSchedule
  return editorialSchedule
}
