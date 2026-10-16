import type React from 'react'

import { capitalize } from '../../utils/capitalize.js'
import { intent } from '../@types/shared.js'
import { size, variant } from './@types/autocomplete.js'
import { Autocomplete, AutocompleteItem } from './autocomplete.js'

export default {
  title: 'Components/Inputs/Autocomplete',
  component: Autocomplete,
  argTypes: {},
}

interface Tag {
  id: string
  value: string
}

const tags: Tag[] = [
  { id: 't1', value: 'feature' },
  { id: 't2', value: 'fix' },
  { id: 't3', value: 'bug' },
  { id: 't4', value: 'docs' },
  { id: 't5', value: 'internal' },
  { id: 't6', value: 'mobile' },
  { id: 'c-accordion', value: 'component: accordion' },
  { id: 'c-alert-dialog', value: 'component: alert dialog' },
  { id: 'c-autocomplete', value: 'component: autocomplete' },
  { id: 'c-avatar', value: 'component: avatar' },
  { id: 'c-checkbox', value: 'component: checkbox' },
  { id: 'c-dialog', value: 'component: dialog' },
  { id: 'c-input', value: 'component: input' },
  { id: 'c-select', value: 'component: select' },
  { id: 'c-tabs', value: 'component: tabs' },
  { id: 'c-toast', value: 'component: toast' },
  { id: 'c-tooltip', value: 'component: tooltip' },
]

export const Default = (): React.JSX.Element => {
  return (
    <div style={{ maxWidth: '600px', margin: '2rem auto' }}>
      <Autocomplete<Tag>
        id="tags-default"
        label="Search tags"
        placeholder="e.g. feature"
        helpText="Start typing to filter tags."
        items={tags}
      >
        {(tag: Tag) => (
          <AutocompleteItem key={tag.id} value={tag}>
            {tag.value}
          </AutocompleteItem>
        )}
      </Autocomplete>
    </div>
  )
}

export const Variants = (): React.JSX.Element => {
  return (
    <div style={{ maxWidth: '1100px', margin: '0 auto' }}>
      {variant.map((v) => {
        return (
          <div
            key={v}
            style={{
              marginBottom: '2rem',
              display: 'grid',
              gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
              alignItems: 'center',
              gap: '3rem',
            }}
          >
            {size.map((s) => {
              return (
                <Autocomplete<Tag>
                  key={`${v}-${s}`}
                  id={`${v}-${s}`}
                  variant={v}
                  inputSize={s}
                  label={`${capitalize(v)} ${s.toUpperCase()}`}
                  placeholder={`${capitalize(v)} ${s.toUpperCase()}`}
                  helpText={`${capitalize(v)} variant, ${s.toUpperCase()} size.`}
                  items={tags}
                >
                  {(tag: Tag) => (
                    <AutocompleteItem key={tag.id} value={tag}>
                      {tag.value}
                    </AutocompleteItem>
                  )}
                </Autocomplete>
              )
            })}
            <Autocomplete<Tag>
              key={`${v}-disabled`}
              id={`${v}-disabled`}
              variant={v}
              disabled
              label={`${capitalize(v)} Disabled`}
              placeholder={`${capitalize(v)} disabled`}
              helpText={`${capitalize(v)} variant, disabled.`}
              items={tags}
            >
              {(tag: Tag) => (
                <AutocompleteItem key={tag.id} value={tag}>
                  {tag.value}
                </AutocompleteItem>
              )}
            </Autocomplete>
          </div>
        )
      })}
    </div>
  )
}

export const Intents = (): React.JSX.Element => {
  return (
    <div style={{ maxWidth: '800px', margin: '0 auto' }}>
      {intent.map((i) => {
        return (
          <div key={i} style={{ marginBottom: '12px' }}>
            <Autocomplete<Tag>
              id={`intent-${i}`}
              variant="outlined"
              intent={i}
              inputSize="md"
              label={capitalize(i)}
              placeholder={capitalize(i)}
              helpText={`${capitalize(i)} intent autocomplete.`}
              items={tags}
            >
              {(tag: Tag) => (
                <AutocompleteItem key={tag.id} value={tag}>
                  {tag.value}
                </AutocompleteItem>
              )}
            </Autocomplete>
          </div>
        )
      })}
    </div>
  )
}

// biome-ignore lint/suspicious/noShadowRestrictedNames: storybook convention
export const Error = (): React.JSX.Element => {
  return (
    <div style={{ maxWidth: '600px', margin: '0 auto' }}>
      <Autocomplete<Tag>
        id="tags-error"
        required
        label="Search tags"
        placeholder="e.g. feature"
        helpText="Please select a tag."
        error={true}
        errorText="Please select a valid tag."
        items={tags}
      >
        {(tag: Tag) => (
          <AutocompleteItem key={tag.id} value={tag}>
            {tag.value}
          </AutocompleteItem>
        )}
      </Autocomplete>
    </div>
  )
}

export const WithoutCustomItem = (): React.JSX.Element => {
  const fruits = ['Apple', 'Banana', 'Cherry', 'Date', 'Elderberry', 'Fig', 'Grape']
  return (
    <div style={{ maxWidth: '600px', margin: '2rem auto' }}>
      <Autocomplete<string>
        id="fruits"
        label="Search fruits"
        placeholder="e.g. Apple"
        helpText="Using plain strings without AutocompleteItem wrapper."
        items={fruits}
      >
        {(fruit: string) => (
          <AutocompleteItem key={fruit} value={fruit}>
            {fruit}
          </AutocompleteItem>
        )}
      </Autocomplete>
    </div>
  )
}
