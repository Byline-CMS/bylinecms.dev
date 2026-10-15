/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/** Bounded housekeeping; expiry and revocation remain independent authorization checks. */
export interface AuthMaintenanceRepository {
  /** Remove at most 100 attempts expired or consumed on/before the supplied grace cutoff. */
  purgeAttempts(before: Date): Promise<number>
  /** Candidate only: eligibility must be checked again under its owning account lock. */
  findTerminalLogin(before: Date): Promise<{ id: string; adminUserId: string } | null>
  /**
   * Requires the owning account lock. Re-read eligibility, delete at most 100 refresh
   * children, then delete the terminal parent only if no children remain. Never cascade.
   */
  pruneTerminalLogin(input: {
    id: string
    adminUserId: string
    before: Date
  }): Promise<{ refreshDeleted: number; loginDeleted: boolean }>
  /** Remove at most 100 legacy null-sid rows expired on/before the retention cutoff. */
  purgeLegacyRefreshTokens(before: Date): Promise<number>
}
