import type { Meta } from '@storybook/react-vite'

export const Colors = (): React.JSX.Element => {
  return (
    <>
      <style>
        {`
        :root {
          --foo: #00FF00;
        }
        table {
          border-collapse: collapse;
          width: 100%;
        }
        td {
          color: black;  
          border: 1px solid #ddd;
          padding: 8px;
          text-align: center;
          font-size: 14px;
        }
      `}
      </style>
      <div style={{ margin: '2rem 0' }}>
        <table>
          <tbody>
            <tr>
              <td style={{ backgroundColor: 'var(--theme-25)' }}>
                theme
                <br />
                25
              </td>
              <td style={{ backgroundColor: 'var(--theme-50)' }}>
                {' '}
                theme
                <br />
                50
              </td>
              <td style={{ backgroundColor: 'var(--theme-100)' }}>
                {' '}
                theme
                <br />
                100
              </td>
              <td style={{ backgroundColor: 'var(--theme-200)' }}>
                theme
                <br />
                200
              </td>
              <td style={{ backgroundColor: 'var(--theme-300)' }}>
                theme
                <br />
                300
              </td>
              <td style={{ backgroundColor: 'var(--theme-400)' }}>
                theme
                <br />
                400
              </td>
              <td style={{ backgroundColor: 'var(--theme-500)' }}>
                theme
                <br />
                500
              </td>
              <td style={{ backgroundColor: 'var(--theme-600)' }}>
                theme
                <br />
                600
              </td>
              <td style={{ backgroundColor: 'var(--theme-700)' }}>
                theme
                <br />
                700
              </td>
              <td style={{ backgroundColor: 'var(--theme-800)' }}>
                theme
                <br />
                800
              </td>
              <td style={{ backgroundColor: 'var(--theme-900)' }}>
                theme
                <br />
                900
              </td>
              <td style={{ backgroundColor: 'var(--theme-950)' }}>
                theme
                <br />
                950
              </td>
            </tr>
            <tr>
              <td style={{ backgroundColor: 'var(--primary-25)' }}>
                primary
                <br />
                25
              </td>
              <td style={{ backgroundColor: 'var(--primary-50)' }}>
                primary
                <br />
                50
              </td>
              <td style={{ backgroundColor: 'var(--primary-100)' }}>
                primary
                <br />
                100
              </td>
              <td style={{ backgroundColor: 'var(--primary-200)' }}>
                primary
                <br />
                200
              </td>
              <td style={{ backgroundColor: 'var(--primary-300)' }}>
                primary
                <br />
                300
              </td>
              <td style={{ backgroundColor: 'var(--primary-400)' }}>
                primary
                <br />
                400
              </td>
              <td style={{ backgroundColor: 'var(--primary-500)' }}>
                primary
                <br />
                500
              </td>
              <td style={{ backgroundColor: 'var(--primary-600)' }}>
                primary
                <br />
                600
              </td>
              <td style={{ backgroundColor: 'var(--primary-700)' }}>
                primary
                <br />
                700
              </td>
              <td style={{ backgroundColor: 'var(--primary-800)' }}>
                primary
                <br />
                800
              </td>
              <td style={{ backgroundColor: 'var(--primary-900)' }}>
                primary
                <br />
                900
              </td>
              <td style={{ backgroundColor: 'var(--primary-950)' }}>
                primary
                <br />
                950
              </td>
            </tr>
            <tr>
              <td style={{ backgroundColor: 'var(--secondary-25)' }}>
                secondary
                <br />
                25
              </td>
              <td style={{ backgroundColor: 'var(--secondary-50)' }}>
                secondary
                <br />
                50
              </td>
              <td style={{ backgroundColor: 'var(--secondary-100)' }}>
                secondary
                <br />
                100
              </td>
              <td style={{ backgroundColor: 'var(--secondary-200)' }}>
                secondary
                <br />
                200
              </td>
              <td style={{ backgroundColor: 'var(--secondary-300)' }}>
                secondary
                <br />
                300
              </td>
              <td style={{ backgroundColor: 'var(--secondary-400)' }}>
                secondary
                <br />
                400
              </td>
              <td style={{ backgroundColor: 'var(--secondary-500)' }}>
                secondary
                <br />
                500
              </td>
              <td style={{ backgroundColor: 'var(--secondary-600)' }}>
                secondary
                <br />
                600
              </td>
              <td style={{ backgroundColor: 'var(--secondary-700)' }}>
                secondary
                <br />
                700
              </td>
              <td style={{ backgroundColor: 'var(--secondary-800)' }}>
                secondary
                <br />
                800
              </td>
              <td style={{ backgroundColor: 'var(--secondary-900)' }}>
                secondary
                <br />
                900
              </td>
              <td style={{ backgroundColor: 'var(--secondary-950)' }}>
                secondary
                <br />
                950
              </td>
            </tr>
            <tr>
              <td style={{ backgroundColor: 'var(--accent-25)' }}>
                accent
                <br />
                25
              </td>
              <td style={{ backgroundColor: 'var(--accent-50)' }}>
                accent
                <br />
                50
              </td>
              <td style={{ backgroundColor: 'var(--accent-100)' }}>
                accent
                <br />
                100
              </td>
              <td style={{ backgroundColor: 'var(--accent-200)' }}>
                accent
                <br />
                200
              </td>
              <td style={{ backgroundColor: 'var(--accent-300)' }}>
                accent
                <br />
                300
              </td>
              <td style={{ backgroundColor: 'var(--accent-400)' }}>
                accent
                <br />
                400
              </td>
              <td style={{ backgroundColor: 'var(--accent-500)' }}>
                accent
                <br />
                500
              </td>
              <td style={{ backgroundColor: 'var(--accent-600)' }}>
                accent
                <br />
                600
              </td>
              <td style={{ backgroundColor: 'var(--accent-700)' }}>
                accent
                <br />
                700
              </td>
              <td style={{ backgroundColor: 'var(--accent-800)' }}>
                accent
                <br />
                800
              </td>
              <td style={{ backgroundColor: 'var(--accent-900)' }}>
                accent
                <br />
                900
              </td>
              <td style={{ backgroundColor: 'var(--accent-950)' }}>
                accent
                <br />
                950
              </td>
            </tr>
            <tr>
              <td style={{ backgroundColor: 'var(--gray-25)' }}>
                gray
                <br />
                25
              </td>
              <td style={{ backgroundColor: 'var(--gray-50)' }}>
                gray
                <br />
                50
              </td>
              <td style={{ backgroundColor: 'var(--gray-100)' }}>
                gray
                <br />
                100
              </td>
              <td style={{ backgroundColor: 'var(--gray-200)' }}>
                gray
                <br />
                200
              </td>
              <td style={{ backgroundColor: 'var(--gray-300)' }}>
                gray
                <br />
                300
              </td>
              <td style={{ backgroundColor: 'var(--gray-400)' }}>
                gray
                <br />
                400
              </td>
              <td style={{ backgroundColor: 'var(--gray-500)' }}>
                gray
                <br />
                500
              </td>
              <td style={{ backgroundColor: 'var(--gray-600)' }}>
                gray
                <br />
                600
              </td>
              <td style={{ backgroundColor: 'var(--gray-700)' }}>
                gray
                <br />
                700
              </td>
              <td style={{ backgroundColor: 'var(--gray-800)' }}>
                gray
                <br />
                800
              </td>
              <td style={{ backgroundColor: 'var(--gray-900)' }}>
                gray
                <br />
                900
              </td>
              <td style={{ backgroundColor: 'var(--gray-950)' }}>
                gray
                <br />
                950
              </td>
            </tr>
            <tr>
              <td style={{ backgroundColor: 'var(--canvas-25)' }}>
                canvas
                <br />
                25
              </td>
              <td style={{ backgroundColor: 'var(--canvas-50)' }}>
                canvas
                <br />
                50
              </td>
              <td style={{ backgroundColor: 'var(--canvas-100)' }}>
                canvas
                <br />
                100
              </td>
              <td style={{ backgroundColor: 'var(--canvas-200)' }}>
                canvas
                <br />
                200
              </td>
              <td style={{ backgroundColor: 'var(--canvas-300)' }}>
                canvas
                <br />
                300
              </td>
              <td style={{ backgroundColor: 'var(--canvas-400)' }}>
                canvas
                <br />
                400
              </td>
              <td style={{ backgroundColor: 'var(--canvas-500)' }}>
                canvas
                <br />
                500
              </td>
              <td style={{ backgroundColor: 'var(--canvas-600)' }}>
                canvas
                <br />
                600
              </td>
              <td style={{ backgroundColor: 'var(--canvas-700)' }}>
                canvas
                <br />
                700
              </td>
              <td style={{ backgroundColor: 'var(--canvas-800)' }}>
                canvas
                <br />
                800
              </td>
              <td style={{ backgroundColor: 'var(--canvas-900)' }}>
                canvas
                <br />
                900
              </td>
              <td style={{ backgroundColor: 'var(--canvas-950)' }}>
                canvas
                <br />
                950
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div style={{ marginBottom: '2rem' }}>
        <table>
          <tbody>
            <tr>
              <td style={{ backgroundColor: 'var(--red-25)' }}>
                red
                <br />
                25
              </td>
              <td style={{ backgroundColor: 'var(--red-50)' }}>
                red
                <br />
                50
              </td>
              <td style={{ backgroundColor: 'var(--red-100)' }}>
                red
                <br />
                100
              </td>
              <td style={{ backgroundColor: 'var(--red-200)' }}>
                red
                <br />
                200
              </td>
              <td style={{ backgroundColor: 'var(--red-300)' }}>
                red
                <br />
                300
              </td>
              <td style={{ backgroundColor: 'var(--red-400)' }}>
                red
                <br />
                400
              </td>
              <td style={{ backgroundColor: 'var(--red-500)' }}>
                red
                <br />
                500
              </td>
              <td style={{ backgroundColor: 'var(--red-600)' }}>
                red
                <br />
                600
              </td>
              <td style={{ backgroundColor: 'var(--red-700)' }}>
                red
                <br />
                700
              </td>
              <td style={{ backgroundColor: 'var(--red-800)' }}>
                red
                <br />
                800
              </td>
              <td style={{ backgroundColor: 'var(--red-900)' }}>
                red
                <br />
                900
              </td>
              <td style={{ backgroundColor: 'var(--red-950)' }}>
                red
                <br />
                950
              </td>
            </tr>
            <tr>
              <td style={{ backgroundColor: 'var(--green-25)' }}>
                green
                <br />
                25
              </td>
              <td style={{ backgroundColor: 'var(--green-50)' }}>
                green
                <br />
                50
              </td>
              <td style={{ backgroundColor: 'var(--green-100)' }}>
                green
                <br />
                100
              </td>
              <td style={{ backgroundColor: 'var(--green-200)' }}>
                green
                <br />
                200
              </td>
              <td style={{ backgroundColor: 'var(--green-300)' }}>
                green
                <br />
                300
              </td>
              <td style={{ backgroundColor: 'var(--green-400)' }}>
                green
                <br />
                400
              </td>
              <td style={{ backgroundColor: 'var(--green-500)' }}>
                green
                <br />
                500
              </td>
              <td style={{ backgroundColor: 'var(--green-600)' }}>
                green
                <br />
                600
              </td>
              <td style={{ backgroundColor: 'var(--green-700)' }}>
                green
                <br />
                700
              </td>
              <td style={{ backgroundColor: 'var(--green-800)' }}>
                green
                <br />
                800
              </td>
              <td style={{ backgroundColor: 'var(--green-900)' }}>
                green
                <br />
                900
              </td>
              <td style={{ backgroundColor: 'var(--green-950)' }}>
                green
                <br />
                950
              </td>
            </tr>
            <tr>
              <td style={{ backgroundColor: 'var(--blue-25)' }}>
                blue
                <br />
                25
              </td>
              <td style={{ backgroundColor: 'var(--blue-50)' }}>
                blue
                <br />
                50
              </td>
              <td style={{ backgroundColor: 'var(--blue-100)' }}>
                blue
                <br />
                100
              </td>
              <td style={{ backgroundColor: 'var(--blue-200)' }}>
                blue
                <br />
                200
              </td>
              <td style={{ backgroundColor: 'var(--blue-300)' }}>
                blue
                <br />
                300
              </td>
              <td style={{ backgroundColor: 'var(--blue-400)' }}>
                blue
                <br />
                400
              </td>
              <td style={{ backgroundColor: 'var(--blue-500)' }}>
                blue
                <br />
                500
              </td>
              <td style={{ backgroundColor: 'var(--blue-600)' }}>
                blue
                <br />
                600
              </td>
              <td style={{ backgroundColor: 'var(--blue-700)' }}>
                blue
                <br />
                700
              </td>
              <td style={{ backgroundColor: 'var(--blue-800)' }}>
                blue
                <br />
                800
              </td>
              <td style={{ backgroundColor: 'var(--blue-900)' }}>
                blue
                <br />
                900
              </td>
              <td style={{ backgroundColor: 'var(--blue-950)' }}>
                blue
                <br />
                950
              </td>
            </tr>
            <tr>
              <td style={{ backgroundColor: 'var(--yellow-25)' }}>
                yellow
                <br />
                25
              </td>
              <td style={{ backgroundColor: 'var(--yellow-50)' }}>
                yellow
                <br />
                50
              </td>
              <td style={{ backgroundColor: 'var(--yellow-100)' }}>
                yellow
                <br />
                100
              </td>
              <td style={{ backgroundColor: 'var(--yellow-200)' }}>
                yellow
                <br />
                200
              </td>
              <td style={{ backgroundColor: 'var(--yellow-300)' }}>
                yellow
                <br />
                300
              </td>
              <td style={{ backgroundColor: 'var(--yellow-400)' }}>
                yellow
                <br />
                400
              </td>
              <td style={{ backgroundColor: 'var(--yellow-500)' }}>
                yellow
                <br />
                500
              </td>
              <td style={{ backgroundColor: 'var(--yellow-600)' }}>
                yellow
                <br />
                600
              </td>
              <td style={{ backgroundColor: 'var(--yellow-700)' }}>
                yellow
                <br />
                700
              </td>
              <td style={{ backgroundColor: 'var(--yellow-800)' }}>
                yellow
                <br />
                800
              </td>
              <td style={{ backgroundColor: 'var(--yellow-900)' }}>
                yellow
                <br />
                900
              </td>
              <td style={{ backgroundColor: 'var(--yellow-950)' }}>
                yellow
                <br />
                950
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </>
  )
}

const meta: Meta = {
  /* 👇 The title prop is optional.
   * See https://storybook.js.org/docs/react/configure/overview#configure-story-loading
   * to learn how to generate automatic titles
   */
  title: 'Base',
  component: Colors,
}

export default meta
