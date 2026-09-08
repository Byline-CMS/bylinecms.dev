/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/** Native JWT login membership. This is not a browser binding or a bearer credential store. */
export interface LoginSessionRow {
  id: string
  admin_user_id: string
  session_version: number
  expires_at: Date
  revoked_at: Date | null
}

export interface LoginSessionsRepository {
  /** All writes run under the owning account lock, through its scoped store. */
  create(input: Omit<LoginSessionRow, 'revoked_at'>): Promise<void>
  findById(id: string): Promise<LoginSessionRow | null>
  extend(id: string, expiresAt: Date): Promise<void>
  revoke(id: string, at?: Date): Promise<void>
  revokeAllForUser(adminUserId: string, at?: Date): Promise<void>
}
