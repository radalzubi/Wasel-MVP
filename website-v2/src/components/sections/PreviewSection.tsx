import { useRef } from 'react'
import { motion, useInView } from 'framer-motion'
import AppPreview from '../phone/AppPreview'
import { fadeUp, staggerContainer, easeOutExpo } from '../../lib/utils'

const steps = [
  { n: '01', label: 'Tap "Where to?"'     },
  { n: '02', label: 'Pick your tier'       },
  { n: '03', label: 'Your driver arrives'  },
]

export default function PreviewSection() {
  const ref    = useRef<HTMLElement>(null)
  const inView = useInView(ref, { once: true, margin: '-15%' })

  return (
    <section id="preview" ref={ref} className="py-32 px-6 border-t border-w-border">
      <div className="max-w-7xl mx-auto grid lg:grid-cols-2 gap-20 items-center">
        {/* Text */}
        <motion.div
          variants={staggerContainer(0.1, 0.1)}
          initial="hidden"
          animate={inView ? 'visible' : 'hidden'}
        >
          <motion.p variants={fadeUp} transition={{ duration: 0.7, ease: easeOutExpo }} className="section-overline">
            The app
          </motion.p>
          <motion.h2
            variants={fadeUp}
            transition={{ duration: 0.8, ease: easeOutExpo }}
            className="section-heading text-[clamp(40px,5vw,64px)] mb-6"
          >
            Everything your<br />ride needs.
          </motion.h2>
          <motion.p variants={fadeUp} transition={{ duration: 0.7, ease: easeOutExpo }} className="text-w-muted text-base leading-relaxed mb-12 max-w-sm">
            Tap through a live demo. No account needed.
            This is exactly what riders and drivers see.
          </motion.p>

          {/* Steps */}
          <div className="space-y-5">
            {steps.map(({ n, label }) => (
              <motion.div
                key={n}
                variants={fadeUp}
                transition={{ duration: 0.6, ease: easeOutExpo }}
                className="flex items-center gap-4"
              >
                <span className="text-w-amber text-xs font-mono font-bold w-8">{n}</span>
                <div className="h-px flex-1 bg-w-border" />
                <span className="text-w-text text-sm font-medium">{label}</span>
              </motion.div>
            ))}
          </div>
        </motion.div>

        {/* Phone */}
        <motion.div
          initial={{ opacity: 0, y: 40 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 1, ease: easeOutExpo, delay: 0.2 }}
          className="flex justify-center"
        >
          <AppPreview />
        </motion.div>
      </div>
    </section>
  )
}
