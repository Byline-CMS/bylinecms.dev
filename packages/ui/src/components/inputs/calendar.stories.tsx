import { useRef, useState } from 'react'

import type { Meta } from '@storybook/react-vite'
import { format } from 'date-fns'
import type { DateRange } from 'react-day-picker'

import { Button } from '../button/button.js'
import { Calendar as CalendarComponent } from './calendar.js'

const meta: Meta<typeof CalendarComponent> = {
  /* 👇 The title prop is optional.
   * See https://storybook.js.org/docs/react/configure/overview#configure-story-loading
   * to learn how to generate automatic titles
   */
  title: 'Components/Inputs/Calendar',
  component: CalendarComponent,
}

export default meta

export const Calendar = (): React.JSX.Element => {
  const [_isOpen, setIsOpen] = useState(false)
  const [time, _setTime] = useState<string>('05:00')
  const [date, setDate] = useState<Date>(new Date())
  const [month, setMonth] = useState<Date>(date)

  const calendarRef = useRef<HTMLDivElement | null>(null)

  return (
    <div style={{ height: '100vh', margin: '2rem 0' }}>
      <div ref={calendarRef} style={{ position: 'relative', width: 'fit-content', margin: 'auto' }}>
        <CalendarComponent
          required
          mode="single"
          captionLayout="dropdown"
          selected={date}
          month={month}
          onMonthChange={setMonth}
          onSelect={(selectedDate: Date) => {
            if (selectedDate) {
              const [hours, minutes] = time.split(':')
              selectedDate.setHours(Number.parseInt(hours, 10), Number.parseInt(minutes, 10))
              setDate(selectedDate)
              setMonth(selectedDate)
            }
          }}
          onDayClick={() => setIsOpen(false)}
          // fromYear={2000}
          // toYear={new Date().getFullYear()}
          // disabled={(date: Date) =>
          //   Number(date) < Date.now() - 1000 * 60 * 60 * 24 ||
          //   Number(date) > Date.now() + 1000 * 60 * 60 * 24 * 30
          // }
        />
        <div style={{ paddingLeft: '1rem', paddingTop: '1rem' }}>
          {date ? `${format(date, 'PPPp')}` : 'No date selected'}
        </div>
        <div style={{ paddingLeft: '1rem', paddingTop: '1rem' }}>
          <Button
            size="sm"
            intent="noeffect"
            style={{ marginTop: '0.5rem' }}
            onClick={() => {
              const today = new Date()
              setDate(today)
              setMonth(today)
            }}
          >
            Today
          </Button>
        </div>
      </div>
    </div>
  )
}

export const Multiple = (): React.JSX.Element => {
  const [_isOpen, setIsOpen] = useState(false)
  const [dates, setDates] = useState<Date[] | undefined>([new Date()])

  const calendarRef = useRef<HTMLDivElement | null>(null)

  return (
    <div style={{ height: '100vh', margin: '2rem 0' }}>
      <div ref={calendarRef} style={{ position: 'relative', width: 'fit-content', margin: 'auto' }}>
        <CalendarComponent
          required
          mode="multiple"
          captionLayout="dropdown"
          selected={dates}
          onSelect={(selectedDates: Date[]) => {
            if (selectedDates) {
              // selectedDate.setHours(Number.parseInt(hours), Number.parseInt(minutes))
              setDates(selectedDates)
            }
          }}
          onDayClick={() => setIsOpen(false)}
          // fromYear={2000}
          // toYear={new Date().getFullYear()}
          // disabled={(date: Date) =>
          //   Number(date) < Date.now() - 1000 * 60 * 60 * 24 ||
          //   Number(date) > Date.now() + 1000 * 60 * 60 * 24 * 30
          // }
        />
      </div>
    </div>
  )
}

export const Range = (): React.JSX.Element => {
  const [_isOpen, setIsOpen] = useState(false)
  const [dateRange, setDateRange] = useState<DateRange | undefined>(undefined)

  const calendarRef = useRef<HTMLDivElement | null>(null)

  return (
    <div style={{ height: '100vh', margin: '2rem 0' }}>
      <div ref={calendarRef} style={{ position: 'relative', width: 'fit-content', margin: 'auto' }}>
        <CalendarComponent
          required
          mode="range"
          captionLayout="dropdown"
          selected={dateRange}
          onSelect={(selectedDateRange: DateRange) => {
            if (selectedDateRange) {
              // selectedDate.setHours(Number.parseInt(hours), Number.parseInt(minutes))
              setDateRange(selectedDateRange)
            }
          }}
          onDayClick={() => setIsOpen(false)}
          // fromYear={2000}
          // toYear={new Date().getFullYear()}
          // disabled={(date: Date) =>
          //   Number(date) < Date.now() - 1000 * 60 * 60 * 24 ||
          //   Number(date) > Date.now() + 1000 * 60 * 60 * 24 * 30
          // }
        />
      </div>
    </div>
  )
}
