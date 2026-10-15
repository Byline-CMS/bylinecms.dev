/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type { PasskeyAdminServices } from '@byline/admin/services'

import {
  getPasskeyCapability,
  passkeyEnrollment,
  passkeyEnrollmentOptions,
  passkeyList,
  passkeyManagementContext,
  passkeyPasswordProof,
  passkeyProof,
  passkeyProofOptions,
  passkeyRemove,
  passkeyRename,
  passkeySignIn,
  passkeySignInOptions,
} from '../server-fns/auth/passkeys.js'
import {
  acceptSession,
  coordinateAuthAction,
  flagSessionChanged,
  notifySessionAction,
  requireUnchanged,
  sessionChangedError,
  sessionSnapshot,
} from './session-coordination.js'

export const passkeyAdminServices: PasskeyAdminServices = {
  capability: () => getPasskeyCapability(),
  captureLogin: (signIn = false) => {
    const snapshot = sessionSnapshot()
    const assertCurrent = () => {
      if (!signIn) return requireUnchanged(snapshot)
      // Explicit reauthentication may begin on an already flagged page, but any
      // subsequent account change still invalidates this particular ceremony.
      const current = sessionSnapshot()
      if (current.epoch !== snapshot.epoch || current.sessionId !== snapshot.sessionId)
        throw sessionChangedError()
    }
    assertCurrent()
    return { expectedSessionId: snapshot.sessionId, assertCurrent }
  },
  managementContext: async (binding) => {
    binding.assertCurrent()
    if (!binding.expectedSessionId) throw sessionChangedError()
    const actor = await passkeyManagementContext({
      data: { expectedSessionId: binding.expectedSessionId },
    })
    binding.assertCurrent()
    return actor
  },
  signInOptions: passkeySignInOptions,
  signIn: (args, binding) =>
    coordinateAuthAction(async () => {
      binding.assertCurrent()
      const result = await passkeySignIn(args)
      acceptSession(result.sessionId)
      notifySessionAction()
      return result
    }),
  passwordProof: passkeyPasswordProof,
  proofOptions: passkeyProofOptions,
  proof: passkeyProof,
  enrollmentOptions: passkeyEnrollmentOptions,
  enrollment: passkeyEnrollment,
  list: passkeyList,
  rename: passkeyRename,
  remove: async (args) => {
    // The mutation middleware queues its fetch, including cookie application;
    // it releases the queue before a pre-handler renewal can acquire it.
    const result = await passkeyRemove(args)
    if (result.signedOut) {
      flagSessionChanged()
      notifySessionAction()
    }
    return result
  },
}
