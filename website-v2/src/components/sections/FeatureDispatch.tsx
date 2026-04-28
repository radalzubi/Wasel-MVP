import { useRef } from 'react'
import { motion, useInView } from 'framer-motion'
import { fadeUp, staggerContainer, easeOutExpo } from '../../lib/utils'

const drivers = [
  { initials: 'AK', name: 'Ahmad K.',  score: 94, dist: '1.8 km', eta: '4 min' },
  { initials: 'SM', name: 'Sara M.',   score: 88, dist: '2.4 km', eta: '6 min' },
  { initials: 'JH', name: 'Jad H.',    score: 79, dist: '1.2 km', eta: '3 min' },
]

export default function FeatureDispatch() {
  const ref    = useRef<HTMLElement>(null)
  const inView = useInView(ref, { once: true, margin: '-12%' })

  return (
    <section ref={ref} className="py-32 px-6 border-t border-w-border">
      <div className="max-w-7xl mx-auto grid lg:grid-cols-2 gap-20 items-center">
        {/* Copy first on lg */}
        <motion.div
          variants={staggerContainer(0.1, 0.1)}
          initial="hidden"
          animate={inView ? 'visible' : 'hidden'}
          className="lg:order-1 order-2"
        >
          <motion.p variants={fadeUp} transition={{ duration: 0.7, ease: easeOutExpo }} className="section-overline">
            Smart dispatch
          </motion.p>
          <motion.h2
            variants={fadeUp}
            transition={{ duration: 0.8, ease: easeOutExpo }}
            className="section-heading text-[clamp(36px,4.5vw,56px)] mb-6"
          >
            Matched by merit,<br />not just distance.
          </motion.h2>
          <motion.p variants={fadeUp} transition={{ duration: 0.7, ease: easeOutExpo }} className="text-w-muted text-base leading-relaxed mb-10 max-w-md">
            Our Balanced Merit Protocol weighs proximity, acceptance rate,
            and idle time together. The best-fit driver wins — not just the
            closest one. No driver sits hungry. No rider waits unnecessarily.
          </motion.p>
          <motion.div variants={fadeUp} transition={{ duration: 0.6, ease: easeOutExpo }} className="space-y-3">
            {[
              { label: 'Proximity',       pct: 40 },
              { label: 'Acceptance rate', pct: 35 },
              { label: 'Idle time',        pct: 25 },
            ].map(({ label, pct }) => (
              <div key={label} className="space-y-1.5">
                <div className="flex justify-between">
                  <span className="text-w-muted text-xs">{label}</span>
                  <span className="text-w-subtle text-xs font-mono">{pct}%</span>
                </div>
                <div className="h-0.5 bg-w-border rounded-full overflow-hidden">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={inView ? { width: pct + '%' } : { width: 0 }}
                    transition={{ duration: 0.9, ease: easeOutExpo, delay: 0.4 }}
                    className="h-full bg-w-amber rounded-full"
                  />
                </div>
              </div>
            ))}
          </motion.div>
        </motion.div>

        {/* BMP score card */}
        <motion.div
          initial={{ opacity: 0, x: 40 }}
          animate={inView ? { opacity: 1, x: 0 } : {}}
          transition={{ duration: 1, ease: easeOutExpo, delay: 0.1 }}
          className="lg:order-2 order-1"
        >
          <div className="rounded-2xl border border-w-border overflow-hidden" style={{ background: '#0F0F11' }}>
            <div className="px-5 py-4 border-b border-w-border">
              <p className="text-w-subtle text-xs font-medium tracking-widest uppercase">BMP — Driver scoring</p>
            </div>
            <div className="divide-y divide-w-border">
              {drivers.map(({ initials, name, score, dist, eta }, i) => (
                <motion.div
                  key={name}
                  initial={{ opacity: 0, x: 20 }}
                  animate={inView ? { opacity: 1, x: 0 } : {}}
                  transition={{ duration: 0.6, ease: easeOutExpo, delay: 0.3 + i * 0.1 }}
                  className={"flex items-center gap-4 px-5 py-4 " + (i === 0 ? 'bg-[#F5A623]/[0.04]' : '')}
                >
                  <div className={"w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 " + (i === 0 ? 'bg-[#F5A623]/15 text-[#F5A623] border border-[#F5A623]/30' : 'bg-white/[0.04] text-w-muted border border-w-border')}>
                    {initials}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-w-text text-sm font-medium truncate">{name}</span>
                      <span className={"text-xs font-bold font-mono " + (i === 0 ? 'text-[#F5A623]' : 'text-w-muted')}>{score}</span>
                    </div>
                    <p className="text-w-subtle text-[11px] mt-0.5">{dist} away &middot; {eta}</p>
                    {/* Score bar */}
                    <div className="mt-1.5 h-0.5 bg-w-border rounded-full overflow-hidden">
                      <motion.div
                        initial={{ width: 0 }}
                        animate={inView ? { width: score + '%' } : { width: 0 }}
                        transition={{ duration: 0.8, ease: easeOutExpo, delay: 0.4 + i * 0.1 }}
                        className={"h-full rounded-full " + (i === 0 ? 'bg-[#F5A623]' : 'bg-white/20')}
                      />
                    </div>
                  </div>
                  {i === 0 && (
                    <div className="flex-shrink-0 w-5 h-5 rounded-full bg-[#F5A623]/15 flex items-center justify-center">
                      <svg className="w-3 h-3 text-[#F5A623]" fill="none" viewBox="0 0 12 12">
                        <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    </div>
                  )}
                </motion.div>
              ))}
            </div>
            <div className="px-5 py-3 border-t border-w-border">
              <p className="text-w-subtle text-[11px]">Ahmad selected — highest merit score</p>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  )
}
