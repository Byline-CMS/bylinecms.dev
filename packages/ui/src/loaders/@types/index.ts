export type LoaderProps = {
  /** hex color */
  color?: string
  /** size as a number (px) or string with units (e.g. '2rem') */
  size?: number | string
} & React.HTMLAttributes<HTMLDivElement>
