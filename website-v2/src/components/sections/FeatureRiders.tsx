import { useRef } from 'react'
import { motion, useInView } from 'framer-motion'
import { fadeUp, staggerContainer, easeOutExpo } from '../../lib/utils'

const tiers = [
  { name: 'Economy',  price: '1.50', note: 'Base fare',      featured: false },
  { name: 'Comfort',  price: '2.50', note: 'Rated 4.8+',    featured: true  },
  { name: 'Premium',  price: '4.00', note: 'Top vehicles',   featured: false },
]

export default function FeatureRiders() {
  const ref    = useRef<HTMLElement>(null)
  const inView = useInView(ref, { once: true, margin: '-12%' })

  return (
    <section id="riders" ref={ref} className="py-32 px-6 border-t border-w-border">
      <div className="max-w-7xl mx-auto grid lg:grid-cols-2 gap-20 items-center">
        {/* Tier cards */}
        <motion.div
          initial={{ opacity: 0, y: 32 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 1, ease: easeOutExpo }}
          className="space-y-3"
        >
          {tiers.map(({ name, price, note, featured }, i) => (
            <motion.div
              key={name}
              initial={{ opacity: 0, x: -24 }}
              animate={inView ? { opacity: 1, x: 0 } : {}}
              transition={{ duration: 0.7, ease: easeOutExpo, delay: 0.15 + i * 0.1 }}
              className={[
                'flex items-center justify-between px-6 py-5 rounded-2xl border transition-colors',
                featured
                  ? 'border-[#F5A623]/30 bg-[#F5A623]/[0.05]'
                  : 'border-w-border bg-w-surface hover:border-white/15',
              ].join(' ')}
            >
              <div>
                <p className={"text-sm font-semibold " + (featured ? 'text-w-text' : 'text-w-muted')}>{name}</p>
                <p className="text-w-subtle text-xs mt-0.5">{note}</p>
              </div>
              <div className="text-right">
                <p className={"text-lg font-black tracking-tight " + (featured ? 'text-[#F5A623]' : 'text-w-text')}>
                  JD {price}
                </p>
                <p className="text-w-subtle text-[10px] mt-0.5">base fare</p>
              </div>
            </motion.div>
          ))}

          {/* No surge guarantee */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={inView ? { opacity: 1 } : {}}
            transition={{ duration: 0.7, ease: easeOutExpo, delay: 0.5 }}
            className="flex items-center gap-3 px-6 py-4 rounded-2xl border border-w-border bg-w-surface"
          >
            <div className="w-8 h-8 rounded-full bg-[#4ADE80]/10 border border-[#4ADE80]/25 flex items-center justify-center flex-shrink-0">
              <svg className="w-4 h-4 text-[#4ADE80]" fill="none" viewBox="0 0 16 16">
                <path d="M3 8l3 3 7-7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
            <div>
              <p className="text-w-text text-sm font-semibold">No surge pricing</p>
              <p className="text-w-subtle text-xs">Rain, Eid, Friday night — same flat rate</p>
            </div>
          </motion.div>
        </motion.div>

        {/* Copy */}
        <motion.div
          variants={staggerContainer(0.1, 0.15)}
          initial="hidden"
          animate={inView ? 'visible' : 'hidden'}
        >
          <motion.p variants={fadeUp} transition={{ duration: 0.7, ease: easeOutExpo }} className="section-overline">
            For Riders
          </motion.p>
          <motion.h2
            variants={fadeUp}
            transition={{ duration: 0.8, ease: easeOutExpo }}
            className="section-heading text-[clamp(36px,4.5vw,56px)] mb-6"
          >
            No surprises.<br />Ever.
          </motion.h2>
          <motion.p variants={fadeUp} transition={{ duration: 0.7, ease: easeOutExpo }} className="text-w-muted text-base leading-relaxed mb-10 max-w-md">
            Three tiers. Flat fares. The price you see before you tap
            is the price you pay. No surge multipliers, no dynamic pricing,
            no hidden fees.
          </motion.p>
          <motion.div variants={fadeUp} transition={{ duration: 0.6, ease: easeOutExpo }} className="space-y-4">
            {[
              'Verified, rated drivers only',
              'Live tracking from the moment you book',
              'Cash or card — your choice',
              'Instant confirmation',
            ].map(line => (
              <div key={line} className="flex items-center gap-3">
                <div className="w-1 h-1 rounded-full bg-w-amber flex-shrink-0" />
                <span className="text-w-text text-sm">{line}</span>
              </div>
            ))}
          </motion.div>
        </motion.div>
      </div>
    </section>
  )
}
