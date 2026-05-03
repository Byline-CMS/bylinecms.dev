'use client'

import type React from 'react'
import type { ComponentPropsWithoutRef, ElementType } from 'react'

import { motion } from 'motion/react'

// Define a generic component type
interface FadeInLiftProps<T extends ElementType> {
  as?: T
  children: React.ReactNode
  duration?: number
  delay?: number
  className?: string
}

// Use a generic type to infer correct props
export const FadeInLift = <T extends ElementType = 'div'>({
  as,
  children,
  className,
  duration = 0.5,
  delay = 0,
  ...rest
}: FadeInLiftProps<T> & Omit<ComponentPropsWithoutRef<T>, keyof FadeInLiftProps<T>>) => {
  const Component = as ? motion.create(as) : motion.div

  return (
    <Component
      className={className}
      initial={{ opacity: 0, y: 30 }}
      whileInView={{
        opacity: 1,
        y: 0,
        transition: { duration, delay },
      }}
      viewport={{ once: true }}
      {...rest}
    >
      {children}
    </Component>
  )
}
