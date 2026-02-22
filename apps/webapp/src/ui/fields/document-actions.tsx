import { useState } from 'react'

import {
  Button,
  CloseIcon,
  DeleteIcon,
  Dropdown as DropdownComponent,
  EllipsisIcon,
  IconButton,
  Modal,
} from '@infonomic/uikit/react'

import type { PublishedVersionInfo } from './form-renderer'

export function DocumentActions({
  publishedVersion,
  onUnpublish,
  onDelete,
}: {
  publishedVersion?: PublishedVersionInfo | null
  onUnpublish?: () => Promise<void>
  onDelete?: () => Promise<void>
}) {
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)

  const handleOnDelete = () => {
    setShowDeleteConfirm(false)
    if (onDelete) {
      onDelete()
    }
  }

  return (
    <>
      <DropdownComponent.Root>
        <DropdownComponent.Trigger asChild>
          <IconButton variant="text" intent="noeffect" size="sm">
            <EllipsisIcon className="rotate-90 text-primary-500" width="15px" height="15px" />
          </IconButton>
        </DropdownComponent.Trigger>

        <DropdownComponent.Portal>
          <DropdownComponent.Content
            className="min-w-[110px]"
            align="end"
            data-side="top"
            sideOffset={10}
          >
            {publishedVersion && (
              <>
                <DropdownComponent.Item onSelect={onUnpublish}>
                  <div className="dropdown-item-content flex items-center ml-2">
                    <span className="dropdown-item-content-icon">
                      {/* <UserIcon width="22px" height="22px" /> */}
                    </span>
                    <span className="dropdown-item-content-text text-sm ">Unpublish</span>
                  </div>
                </DropdownComponent.Item>
                <DropdownComponent.Separator />
              </>
            )}
            <DropdownComponent.Item onSelect={() => {
              setShowDeleteConfirm(true)
            }}>
              <div className="dropdown-item-content flex items-center ml-1">
                <span className="dropdown-item-content-icon inline-block w-[28px]">
                  <DeleteIcon width="16px" height="16px" />
                </span>
                <span className="dropdown-item-content-text text-left text-sm inline-block w-full">
                  <button
                    type="button"
                    className="text-left inline-block w-full flex-1 leading-none text-red-600 dark:text-red-400"
                  >
                    Delete
                  </button>
                </span>
              </div>
            </DropdownComponent.Item>
          </DropdownComponent.Content>
        </DropdownComponent.Portal>
      </DropdownComponent.Root>

      <Modal
        isOpen={showDeleteConfirm}
        closeOnOverlayClick={true}
        onDismiss={() => {
          setShowDeleteConfirm(false)
        }}
      >
        <Modal.Container style={{ maxWidth: '500px' }}>
          <Modal.Header className="pt-4 mb-2">
            <h3 className="m-0 mb-2 text-2xl">Delete Document</h3>
            <IconButton
              arial-label="Close"
              size="xs"
              onClick={() => {
                setShowDeleteConfirm(false)
              }}
            >
              <CloseIcon width="16px" height="16px" svgClassName="white-icon" />
            </IconButton>
          </Modal.Header>
          <Modal.Content>
            <p>
              Warning: This action cannot be undone. Are you sure you want to delete this document?
            </p>
          </Modal.Content>
          <Modal.Actions>
            <button data-autofocus type="button" tabIndex={0} className="sr-only">
              no action
            </button>
            <Button size="sm" intent="noeffect" onClick={() => {
              setShowDeleteConfirm(false)
            }}>
              Cancel
            </Button>
            <Button size="sm" intent="danger" onClick={handleOnDelete}>
              Delete
            </Button>
          </Modal.Actions>
        </Modal.Container>
      </Modal>
    </>
  )
}
