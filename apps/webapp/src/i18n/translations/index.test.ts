import { describe, expect, test } from 'vitest'

import { createTranslator, getTranslations } from '../translations'

describe('translations', () => {
  test('get translations for contact namespace with getTranslations', async () => {
    const translations = await getTranslations('en')
    expect(translations.contact.email).toEqual('Email')
  })
  test('get translations for contact namespace with createTranslator', async () => {
    const { t } = await createTranslator('en', 'contact')
    expect(t('email')).toEqual('Email')
  })
  test('get translations with string interpolation', async () => {
    const { t } = await createTranslator('en', 'test')
    const output = t('welcome', { name: 'Bob' })
    // console.log(output)
    expect(output).toEqual('Welcome, Bob')
  })
  test('get translations with number interpolation', async () => {
    const { t } = await createTranslator('en', 'test')
    const output = t('total', { count: 3 })
    // console.log(output)
    expect(output).toEqual('You your total is 3')
  })
  test('get translations with plural singular interpolation', async () => {
    const { t } = await createTranslator('en', 'test')
    const output = t('unreadMessages', { count: 1 })
    // console.log(output)
    expect(output).toEqual('You have 1 unread message')
  })

  test('get translations with plural more than one interpolation', async () => {
    const { t } = await createTranslator('en', 'test')
    const output = t('unreadMessages', { count: 3 })
    // console.log(output)
    expect(output).toEqual('You have 3 unread messages')
  })

  test('get translations with date interpolation', async () => {
    const { t } = await createTranslator('en', 'test')
    const output = t('publishedOn', { published: 1705024329653 })
    // console.log(output)
    expect(output).toEqual('Published on Jan 12, 2024')
  })
})
