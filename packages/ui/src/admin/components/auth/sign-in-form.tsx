/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Admin sign-in form.
 *
 * Client component — collects email + password, calls the `adminSignIn`
 * server fn, and on success navigates to the caller-supplied
 * `callbackUrl` (or `/admin`). On failure renders a generic "Invalid
 * credentials" alert; the provider equalises timing between
 * unknown-email and wrong-password so the UI doesn't distinguish the two.
 *
 * Stable override handles: `.byline-sign-in-card`, `.byline-sign-in-alert`,
 * `.byline-sign-in-form`, `.byline-sign-in-fields`,
 * `.byline-sign-in-actions`, `.byline-sign-in-button`.
 */

import { type FormEvent, useState } from 'react'

import { Alert, Button, Card, Input, LoaderEllipsis } from '@infonomic/uikit/react'
import cx from 'classnames'

import { useBylineAdminServices } from '../../../services/admin-services-context.js'
import styles from './sign-in-form.module.css'

interface SignInFormProps {
  /** Destination after successful sign-in. Defaults to `/admin`. */
  callbackUrl?: string
}

export function SignInForm({ callbackUrl }: SignInFormProps) {
  const { adminSignIn } = useBylineAdminServices()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pending) return
    if (email.trim().length === 0 || password.length === 0) {
      setError('Enter your email and password.')
      return
    }

    setPending(true)
    setError(null)
    try {
      await adminSignIn({ data: { email: email.trim(), password } })
      const target = callbackUrl && callbackUrl.length > 0 ? callbackUrl : '/admin'
      // Full-page navigation — the admin layout needs to re-run its
      // `beforeLoad` guard against the freshly-set session cookies.
      window.location.assign(target)
    } catch (err) {
      console.warn('sign-in failed', err)
      setError('Invalid credentials.')
      setPending(false)
    }
  }

  return (
    <Card className={cx('byline-sign-in-card', styles.card)}>
      <Card.Header>
        <Card.Title>
          <h2>Sign in</h2>
        </Card.Title>
        <Card.Description>Sign in to the Byline admin.</Card.Description>
        {error && (
          <Alert intent="danger" className={cx('byline-sign-in-alert', styles.alert)}>
            {error}
          </Alert>
        )}
      </Card.Header>
      <Card.Content>
        <form onSubmit={handleSubmit} noValidate className={cx('byline-sign-in-form', styles.form)}>
          <div className={cx('byline-sign-in-fields', styles.fields)}>
            <Input
              label="Email"
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(event) => setEmail(event.currentTarget.value)}
              disabled={pending}
            />
            <Input
              label="Password"
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(event) => setPassword(event.currentTarget.value)}
              disabled={pending}
            />
          </div>
          <div className={cx('byline-sign-in-actions', styles.actions)}>
            <Button
              type="submit"
              disabled={pending}
              className={cx('byline-sign-in-button', styles.button)}
            >
              {pending ? <LoaderEllipsis size={30} color="#aaaaaa" /> : <span>Sign In</span>}
            </Button>
          </div>
        </form>
      </Card.Content>
    </Card>
  )
}
