import type { LinkAttributes } from '../../../nodes/link-nodes'

/**
 * The payload of a link node
 * This can be delivered from the link node to the drawer, or from the drawer/anything to the TOGGLE_LINK_COMMAND
 */
export interface LinkData {
  fields: LinkAttributes
  /**
   * The text content of the link node - will be displayed in the drawer
   */
  text: null | string
}

export interface LinkModalProps {
  isOpen: boolean
  onClose: () => void
  onSubmit: (data: LinkData) => void
  data?: LinkData
}
