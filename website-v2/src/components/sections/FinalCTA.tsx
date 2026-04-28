import { useRef } from 'react'
import { motion, useInView } from 'framer-motion'
import { fadeUp, staggerContainer, easeOutExpo } from '../../lib/utils'

export default function FinalCTA() {
  const ref    = useRef<HTMLElement>(null)
  const inView = useInView(ref, { once: true, margin: '-10%' })

  return (
    <section id="waitlist" ref={ref} className="py-40 px-6 border-t border-w-border relative overflow-hidden">
      {/* Ambient glow */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background: 'radial-gradient(ellipse 80% 50% at 50% 100%, rgba(245,166,35,0.07) 0%, transparent 70%)',
        }}
      />

      <div className="max-w-3xl mx-auto text-center relative z-10">
        <motion.div
          variants={staggerContainer(0.12, 0.1)}
          initial="hidden"
          animate={inView ? 'visible' : 'hidden'}
        >
          <motion.p variants={fadeUp} transition={{ duration: 0.7, ease: easeOutExpo }} className="section-overline mb-6">
            Early access
          </motion.p>
          <motion.h2
            variants={fadeUp}
            transition={{ duration: 0.9, ease: easeOutExpo }}
            className="text-[clamp(48px,8vw,96px)] font-black tracking-tightest text-w-text leading-[0.9] mb-8"
          >
            Amman<br />is next.
          </motion.h2>
          <motion.p variants={fadeUp} transition={{ duration: 0.7, ease: easeOutExpo }} className="text-w-muted text-lg leading-relaxed mb-12 max-w-lg mx-auto">
            Be among the first riders and drivers on واصل.
            Riders get 3 free rides. Drivers get their first month at half price.
          </motion.p>

          <motion.div
            variants={fadeUp}
            transition={{ duration: 0.7, ease: easeOutExpo }}
            className="flex flex-col sm:flex-row items-center justify-center gap-3"
          >
            <a href="#" className="btn-primary px-10 py-4 text-sm w-full sm:w-auto text-center">
              Join as a Rider
            </a>
            <a href="#" className="btn-secondary px-10 py-4 text-sm w-full sm:w-auto text-center">
              Join as a Driver
            </a>
          </motion.div>

          <motion.div
            variants={fadeUp}
            transition={{ duration: 0.6, ease: easeOutExpo }}
            className="mt-8 flex items-center justify-center gap-6"
          >
            <span className="text-w-subtle text-xs">App Store</span>
            <div className="w-px h-3 bg-w-border" />
            <span className="text-w-subtle text-xs">Google Play</span>
            <div className="w-px h-3 bg-w-border" />
            <span className="text-w-subtle text-xs">Coming soon</span>
          </motion.div>
        </motion.div>
      </div>
    </section>
  )
}
