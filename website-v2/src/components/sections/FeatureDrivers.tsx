import { useRef } from 'react'
import { motion, useInView } from 'framer-motion'
import { fadeUp, staggerContainer, easeOutExpo } from '../../lib/utils'

export default function FeatureDrivers() {
  const ref    = useRef<HTMLElement>(null)
  const inView = useInView(ref, { once: true, margin: '-12%' })

  return (
    <section id="drivers" ref={ref} className="py-32 px-6 border-t border-w-border">
      <div className="max-w-7xl mx-auto grid lg:grid-cols-2 gap-20 items-center">
        {/* Left — big stat */}
        <motion.div
          initial={{ opacity: 0, x: -40 }}
          animate={inView ? { opacity: 1, x: 0 } : {}}
          transition={{ duration: 1, ease: easeOutExpo }}
          className="relative"
        >
          {/* Earnings card mockup */}
          <div
            className="relative overflow-hidden rounded-2xl border border-w-border p-8"
            style={{ background: '#0F0F11' }}
          >
            <p className="text-w-subtle text-xs font-medium tracking-widest uppercase mb-6">Your earnings today</p>
            <p className="text-[#F5A623] text-7xl font-black tracking-tightest leading-none">
              JD&thinsp;44
              <span className="text-4xl">.80</span>
            </p>
            <p className="text-w-muted text-sm mt-3">8 trips &middot; 6.2 hrs online</p>

            <div className="mt-8 space-y-2.5">
              {[
                { label: 'Fares collected', value: 'JD 47.80',  color: 'text-w-text' },
                { label: 'Subscription',    value: '− JD 3.00', color: 'text-w-muted' },
                { label: 'Commission',       value: 'JD 0.00',  color: 'text-[#4ADE80]' },
              ].map(({ label, value, color }) => (
                <div key={label} className="flex justify-between items-center py-2.5 border-t border-w-border first:border-t-0">
                  <span className="text-w-muted text-sm">{label}</span>
                  <span className={"text-sm font-semibold " + color}>{value}</span>
                </div>
              ))}
            </div>

            {/* Bar chart */}
            <div className="mt-8 flex items-end gap-1.5 h-14">
              {[40, 60, 45, 85, 70, 55, 90].map((h, i) => (
                <motion.div
                  key={i}
                  initial={{ height: 0 }}
                  animate={inView ? { height: h + '%' } : { height: 0 }}
                  transition={{ duration: 0.6, ease: easeOutExpo, delay: 0.3 + i * 0.07 }}
                  className={"flex-1 rounded-t-sm " + (h >= 80 ? 'bg-[#F5A623]' : 'bg-[#F5A623]/25')}
                />
              ))}
            </div>
          </div>
        </motion.div>

        {/* Right — copy */}
        <motion.div
          variants={staggerContainer(0.1, 0.15)}
          initial="hidden"
          animate={inView ? 'visible' : 'hidden'}
        >
          <motion.p variants={fadeUp} transition={{ duration: 0.7, ease: easeOutExpo }} className="section-overline">
            For Drivers
          </motion.p>
          <motion.h2
            variants={fadeUp}
            transition={{ duration: 0.8, ease: easeOutExpo }}
            className="section-heading text-[clamp(36px,4.5vw,56px)] mb-6"
          >
            The math<br />finally works.
          </motion.h2>
          <motion.p variants={fadeUp} transition={{ duration: 0.7, ease: easeOutExpo }} className="text-w-muted text-base leading-relaxed mb-10 max-w-md">
            Pay a flat daily subscription. Drive as many trips as you want.
            Every fare is yours — no percentage disappearing into a platform.
          </motion.p>
          <motion.div variants={fadeUp} transition={{ duration: 0.6, ease: easeOutExpo }} className="space-y-4">
            {[
              'JD 0 commission, ever',
              'Silver · Gold · Platinum plans',
              'Real-time earnings dashboard',
              'Drive at your own pace',
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
