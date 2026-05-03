/**
 * Material-style ripple effect.
 *
 * Based on material-ripple-effects by Sajad Ahmad Nawabi (https://github.com/sajadevo/material-ripple-effects)
 * Original work licensed under the MIT License.
 * Copyright (c) 2021 Sajad Ahmad Nawabi
 *
 * Adapted for use as an internal ESM/TypeScript module with minor improvements.
 */

export type RippleColor = 'light' | 'dark'

export class Ripple {
  private x = 0
  private y = 0
  private z = 0

  private findFurthestPoint(
    clickPointX: number,
    elementWidth: number,
    offsetX: number,
    clickPointY: number,
    elementHeight: number,
    offsetY: number
  ): number {
    this.x = clickPointX - offsetX > elementWidth / 2 ? 0 : elementWidth
    this.y = clickPointY - offsetY > elementHeight / 2 ? 0 : elementHeight
    this.z = Math.hypot(this.x - (clickPointX - offsetX), this.y - (clickPointY - offsetY))

    return this.z
  }

  private applyStyles(
    element: HTMLSpanElement,
    color: RippleColor,
    rect: DOMRect,
    radius: number,
    clientX: number,
    clientY: number
  ): void {
    element.classList.add('ripple')
    element.style.backgroundColor = color === 'dark' ? 'rgba(0,0,0, 0.2)' : 'rgba(255,255,255, 0.3)'
    element.style.borderRadius = '50%'
    element.style.pointerEvents = 'none'
    element.style.position = 'absolute'
    element.style.left = `${clientX - rect.left - radius}px`
    element.style.top = `${clientY - rect.top - radius}px`
    element.style.width = element.style.height = `${radius * 2}px`
  }

  private applyAnimation(element: HTMLSpanElement): void {
    element.animate(
      [
        { transform: 'scale(0)', opacity: 1 },
        { transform: 'scale(1.5)', opacity: 0 },
      ],
      {
        duration: 500,
        easing: 'linear',
      }
    )
  }

  create(
    event: MouseEvent | { clientX: number; clientY: number; currentTarget: EventTarget | null },
    color: RippleColor = 'light'
  ): void {
    const element = event.currentTarget as HTMLElement

    element.style.position = 'relative'
    element.style.overflow = 'hidden'

    const rect = element.getBoundingClientRect()

    const radius = this.findFurthestPoint(
      event.clientX,
      element.offsetWidth,
      rect.left,
      event.clientY,
      element.offsetHeight,
      rect.top
    )

    const circle = document.createElement('span')

    this.applyStyles(circle, color, rect, radius, event.clientX, event.clientY)
    this.applyAnimation(circle)

    element.appendChild(circle)

    setTimeout(() => circle.remove(), 500)
  }
}

export default Ripple
