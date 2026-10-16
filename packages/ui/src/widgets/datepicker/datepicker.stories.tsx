import { DatePicker } from './datepicker.js'

export default {
  title: 'Widgets/DatePicker',
  component: DatePicker,
  argTypes: {},
}

export const Default = (): React.JSX.Element => {
  const handleDateChange = (value: Date | null): void => {
    console.log('Selected date:', value)
  }

  return (
    <div style={{ maxWidth: '270px', margin: '2rem auto' }}>
      <div style={{ display: 'flex', flexDirection: 'column', marginBottom: '1.5rem' }}>
        <span>Date and Time</span>
        <DatePicker
          onDateChange={handleDateChange}
          id="published_on"
          name="published_on"
          yearsInPast={70}
          variant="outlined"
          helpText="Select published on date."
        />
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', marginBottom: '1.5rem' }}>
        <span>Date</span>
        <DatePicker
          onDateChange={handleDateChange}
          mode="date"
          id="published_on"
          name="published_on"
          variant="outlined"
          yearsInPast={70}
          helpText="Select published on date."
        />
      </div>
    </div>
  )
}
