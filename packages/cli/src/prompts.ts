import * as p from '@clack/prompts'

export interface Prompter {
  text(opts: { message: string; placeholder?: string; defaultValue?: string }): Promise<string>
  /**
   * Password prompt. The optional `validate` callback returns an error string
   * to keep the prompt re-prompting the same field, or `undefined` when the
   * value is acceptable. Mirrors `@clack/prompts` semantics — failed
   * validation does NOT count as a cancel, the user gets another try.
   */
  password(opts: {
    message: string
    validate?: (value: string) => string | undefined
  }): Promise<string>
  select<T extends string>(opts: {
    message: string
    options: { value: T; label: string; hint?: string }[]
  }): Promise<T>
  confirm(opts: { message: string; defaultValue?: boolean }): Promise<boolean>
  spinner(): { start(msg: string): void; stop(msg?: string): void }
  intro(msg: string): void
  outro(msg: string): void
  note(body: string, title?: string): void
  cancel(msg: string): never
}

export function createPrompter(opts: { yes?: boolean } = {}): Prompter {
  const yes = opts.yes === true

  return {
    async text({ message, placeholder, defaultValue }) {
      if (yes && defaultValue !== undefined) return defaultValue
      const v = await p.text({ message, placeholder, defaultValue })
      if (p.isCancel(v)) cancel('cancelled')
      return v as string
    },
    async password({ message, validate }) {
      const v = await p.password({ message, validate })
      if (p.isCancel(v)) cancel('cancelled')
      return v as string
    },
    async select({ message, options }) {
      const first = options[0]
      if (yes && first !== undefined) return first.value
      const v = await p.select({ message, options: options as never })
      if (p.isCancel(v)) cancel('cancelled')
      return v as never
    },
    async confirm({ message, defaultValue = true }) {
      if (yes) return defaultValue
      const v = await p.confirm({ message, initialValue: defaultValue })
      if (p.isCancel(v)) cancel('cancelled')
      return v as boolean
    },
    spinner() {
      return p.spinner()
    },
    intro: (m) => p.intro(m),
    outro: (m) => p.outro(m),
    note: (body, title) => p.note(body, title),
    cancel,
  }
}

function cancel(msg: string): never {
  p.cancel(msg)
  process.exit(0)
}
