import { describe, expect, it } from 'vitest'

import { DEFAULT_WORKFLOW } from '../@types/collection-types.js'
import {
  getAvailableTransitions,
  getDefaultStatus,
  getWorkflow,
  getWorkflowStatuses,
  validateStatusTransition,
} from './workflow.js'
import type { CollectionDefinition, WorkflowConfig } from '../@types/collection-types.js'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const fourStepWorkflow: WorkflowConfig = {
  statuses: [
    { name: 'draft', label: 'Draft' },
    { name: 'needs_review', label: 'Needs Review' },
    { name: 'published', label: 'Published' },
    { name: 'archived', label: 'Archived' },
  ],
}

const minimalCollection: CollectionDefinition = {
  path: 'test',
  labels: { singular: 'Test', plural: 'Tests' },
  fields: [],
}

const collectionWithWorkflow: CollectionDefinition = {
  ...minimalCollection,
  workflow: fourStepWorkflow,
}

const collectionWithCustomDefault: CollectionDefinition = {
  ...minimalCollection,
  workflow: {
    statuses: fourStepWorkflow.statuses,
    defaultStatus: 'needs_review',
  },
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Workflow helpers', () => {
  describe('getWorkflow', () => {
    it('returns the collection workflow when defined', () => {
      expect(getWorkflow(collectionWithWorkflow)).toBe(fourStepWorkflow)
    })

    it('falls back to DEFAULT_WORKFLOW when omitted', () => {
      expect(getWorkflow(minimalCollection)).toBe(DEFAULT_WORKFLOW)
    })
  })

  describe('getWorkflowStatuses', () => {
    it('returns statuses array from the workflow', () => {
      const statuses = getWorkflowStatuses(collectionWithWorkflow)
      expect(statuses.map((s) => s.name)).toEqual([
        'draft',
        'needs_review',
        'published',
        'archived',
      ])
    })
  })

  describe('getDefaultStatus', () => {
    it('returns the first status by default', () => {
      expect(getDefaultStatus(collectionWithWorkflow)).toBe('draft')
    })

    it('respects an explicit defaultStatus override', () => {
      expect(getDefaultStatus(collectionWithCustomDefault)).toBe('needs_review')
    })

    it('falls back to "draft" for an empty statuses array', () => {
      const col: CollectionDefinition = {
        ...minimalCollection,
        workflow: { statuses: [] },
      }
      expect(getDefaultStatus(col)).toBe('draft')
    })
  })
})

describe('validateStatusTransition', () => {
  const w = fourStepWorkflow

  it('allows same-status (no-op)', () => {
    expect(validateStatusTransition(w, 'draft', 'draft')).toEqual({ valid: true })
  })

  it('allows forward one step', () => {
    expect(validateStatusTransition(w, 'draft', 'needs_review')).toEqual({ valid: true })
    expect(validateStatusTransition(w, 'needs_review', 'published')).toEqual({ valid: true })
    expect(validateStatusTransition(w, 'published', 'archived')).toEqual({ valid: true })
  })

  it('allows backward one step', () => {
    expect(validateStatusTransition(w, 'needs_review', 'draft')).toEqual({ valid: true })
    expect(validateStatusTransition(w, 'published', 'needs_review')).toEqual({ valid: true })
    expect(validateStatusTransition(w, 'archived', 'published')).toEqual({ valid: true })
  })

  it('allows reset to first status from any position', () => {
    expect(validateStatusTransition(w, 'published', 'draft')).toEqual({ valid: true })
    expect(validateStatusTransition(w, 'archived', 'draft')).toEqual({ valid: true })
  })

  it('rejects skipping steps forward', () => {
    const result = validateStatusTransition(w, 'draft', 'published')
    expect(result.valid).toBe(false)
    expect(result.reason).toContain('draft')
    expect(result.reason).toContain('published')
  })

  it('rejects skipping steps backward (not reset-to-first)', () => {
    const result = validateStatusTransition(w, 'archived', 'needs_review')
    expect(result.valid).toBe(false)
    expect(result.reason).toContain('archived')
    expect(result.reason).toContain('needs_review')
  })

  it('rejects unknown current status', () => {
    const result = validateStatusTransition(w, 'unknown', 'draft')
    expect(result.valid).toBe(false)
    expect(result.reason).toContain('unknown')
  })

  it('rejects unknown target status', () => {
    const result = validateStatusTransition(w, 'draft', 'unknown')
    expect(result.valid).toBe(false)
    expect(result.reason).toContain('unknown')
  })
})

describe('getAvailableTransitions', () => {
  const w = fourStepWorkflow

  it('from first status: only forward', () => {
    expect(getAvailableTransitions(w, 'draft')).toEqual(['needs_review'])
  })

  it('from middle status: reset-to-first, back, and forward', () => {
    expect(getAvailableTransitions(w, 'needs_review')).toEqual(['draft', 'published'])
  })

  it('from second-to-last: reset-to-first, back, and forward', () => {
    expect(getAvailableTransitions(w, 'published')).toEqual(['draft', 'needs_review', 'archived'])
  })

  it('from last status: reset-to-first and back', () => {
    expect(getAvailableTransitions(w, 'archived')).toEqual(['draft', 'published'])
  })

  it('returns empty for unknown status', () => {
    expect(getAvailableTransitions(w, 'bogus')).toEqual([])
  })
})
