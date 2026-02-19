'use client'

import { useState } from 'react'

import { Card, GripperVerticalIcon } from '@infonomic/uikit/react'
import cx from 'classnames'

import { DraggableSortable, moveItem, useSortable } from '@/ui/dnd/draggable-sortable'

const sourceItems = [
  {
    id: '1',
    name: 'Item 1',
  },
  {
    id: '2',
    name: 'Item 2',
  },
  {
    id: '3',
    name: 'Item 3',
  },
  {
    id: '4',
    name: 'Item 4',
  },
  {
    id: '5',
    name: 'Item 5',
  },
  {
    id: '6',
    name: 'Item 6',
  },
  {
    id: '7',
    name: 'Item 7',
  },
  {
    id: '8',
    name: 'Item 8',
  },
]

type DraggableCardProps = {
  item: { id: string; name: string }
  isSortable: boolean
  disabled: boolean
}

// Card component
const DraggableCard: React.FC<DraggableCardProps> = ({ item, disabled, isSortable = true }) => {
  const { attributes, isDragging, listeners, setNodeRef, transform, transition } = useSortable({
    id: item.id,
    disabled,
    transition: {
      duration: 250,
      easing: 'cubic-bezier(0, 0.2, 0.2, 1)',
    },
  })

  return (
    <Card
      ref={setNodeRef as any}
      className={cx(
        'mb-4 bg-canvas-25 relative shadow',
        'flex flex-col min-w-full no-underline max-w-sm p-6',
        'bg-white border border-canvas-25 rounded-lg shadow-md',
        'dark:bg-canvas-800 ',
        //  'transition ease-in-out duration-200',
        { 'shadow-lg': isDragging }
      )}
      style={{
        // @ts-expect-error
        transform: transform && `translate3d(${transform.x}px, ${transform.y}px, 0)`, // translate3d is faster than translate in most browsers
        transition,
        zIndex: isDragging ? '10' : 'auto',
      }}
    >
      <div className="header flex justify-start items-center">
        <div className="mr-2" {...attributes} {...listeners}>
          <GripperVerticalIcon />
        </div>
        <h3>{item.name}</h3>
      </div>
      <p>Card {item.id}</p>
    </Card>
  )
}

export function DraggableList(): React.JSX.Element {
  const [items, setItems] = useState(sourceItems)
  const handleOnDragEnd = ({
    event,
    moveFromIndex,
    moveToIndex,
  }: {
    event: any
    moveFromIndex: number
    moveToIndex: number
  }) => {
    const newItems = moveItem(items, moveFromIndex, moveToIndex)
    setItems(newItems)
  }

  return (
    <div className="mx-auto max-w-[600px] relative">
      <DraggableSortable
        ids={items.map((item) => item.id)}
        onDragEnd={handleOnDragEnd}
        className=""
      >
        {items.map((item) => (
          <DraggableCard key={item.id} disabled={false} isSortable={true} item={item} />
        ))}
      </DraggableSortable>
    </div>
  )
}
