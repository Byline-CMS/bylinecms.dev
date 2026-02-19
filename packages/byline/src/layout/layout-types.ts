// Layout / presentation types for Byline collections

export interface LayoutFieldRef {
  target: string
  label?: string
  helpText?: string
}

export interface LayoutRow {
  kind: 'row'
  id: string
  fields: LayoutFieldRef[]
}

export interface LayoutSection {
  kind: 'section'
  id: string
  label?: string
  description?: string
  fields: (LayoutFieldRef | LayoutRow)[]
}

export interface LayoutTab {
  id: string
  label: string
  sections: LayoutSection[]
}

export interface LayoutBlockPalette {
  target: string
  allowedBlockTypes?: string[]
}

export interface LayoutCollection {
  id: string
  tabs: LayoutTab[]
  blocks?: LayoutBlockPalette[]
}
