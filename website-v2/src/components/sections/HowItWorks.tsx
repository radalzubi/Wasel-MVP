import { useRef } from 'react'
import { motion, useInView } from 'framer-motion'
import { fadeUp, staggerContainer, easeOutExpo } from '../../lib/utils'

const steps = [
  {
    n: '01',
    title: 'Choose a plan',
    body: 'Drivers pick Silver, Gold, or Platinum. Riders sign up free and start booking immediately.',
  },
  {
    n: '02',
    title: 'We match you',
    body: 'Our algorithm weighs proximity, rating, and idle time to find the best available driver — instantly.',
  },
  {
    n: '03',
    title: 'Ride and earn',
    body: 'Riders pay a flat fare. Drivers keep every fils. No commission taken, no surprises on either side.',
  },
]

export default function HowItWorks() {
  const ref    = useRef<HTMLElement>(null)
  const inView = useInView(ref, { once: true, margin: '-12%' })

  return (
    <section ref={ref} className="py-32 px-6 border-t border-w-border">
      <div className="max-w-7xl mx-auto">
        <motion.div
          variants={staggerContainer(0.08)}
          initial="hidden"
          animate={inView ? 'visible' : 'hidden'}
          className="text-center mb-20"
        >
          <motion.p variants={fadeUp} transition={{ duration: 0.7, ease: easeOutExpo }} className="section-overline">
            How it works
          </motion.p>
          <motion.h2
            variants={fadeUp}
            transition={{ duration: 0.8, ease: easeOutExpo }}
            className="section-heading text-[clamp(36px,4.5vw,56px)]"
          >
            Three steps.
          </motion.h2>
        </motion.div>

        <div className="grid md:grid-cols-3 gap-px bg-w-border rounded-2xl overflow-hidden">
          {steps.map(({ n, title, body }, i) => (
            <motion.div
              key={n}
              initial={{ opacity: 0, y: 24 }}
              animate={inView ? { opacity: 1, y: 0 } : {}}
              transition={{ duration: 0.7, ease: easeOutExpo, delay: 0.1 + i * 0.12 }}
              className="bg-w-bg px-8 py-10"
            >
              <span className="text-[#F5A623] text-xs font-mono font-bold tracking-widest block mb-8">{n}</span>
              <h3 className="text-w-text text-xl font-bold tracking-tight mb-3">{title}</h3>
              <p className="text-w-muted text-sm leading-relaxed">{body}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  )
}
