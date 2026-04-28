/** Ease-out expo — premium "landing" feel */
export const easeOutExpo = [0.16, 1, 0.3, 1] as const

/** Ease-out cubic — snappy UI transitions */
export const easeOutCubic = [0.33, 1, 0.68, 1] as const

/** Fade-up motion preset */
export const fadeUp = {
  hidden:  { opacity: 0, y: 28 },
  visible: { opacity: 1, y: 0  },
}

/** Stagger container */
export const staggerContainer = (stagger = 0.12, delay = 0) => ({
  hidden:  {},
  visible: { transition: { staggerChildren: stagger, delayChildren: delay } },
})

/** Clamp number between min/max */
export function clamp(n: number, min: number, max: number) {
  return Math.min(Math.max(n, min), max)
}
