import { useRef } from 'react'
import { motion, useInView, useMotionValue, animate } from 'framer-motion'
import { useEffect } from 'react'
import { easeOutExpo } from '../../lib/utils'

const stats = [
  { value: 100, suffix: '%',  label: 'Fares kept by drivers'  },
  { value: 0,   suffix: '%',  label: 'Commission taken'         },
  { value: 3,   suffix: '',   label: 'Ride tiers'              },
  { value: 3,   suffix: ' JD', label: 'Average daily cost'     },
]

function Counter({ target, suffix }: { target: number; suffix: string }) {
  const ref    = useRef<HTMLSpanElement>(null)
  const count  = useMotionValue(0)

  useEffect(() => {
    const controls = animate(count, target, {
      duration: 1.8,
      ease: 'easeOut',
      onUpdate(v) {
        if (ref.current) ref.current.textContent = Math.round(v) + suffix
      },
    })
    return controls.stop
  }, [target])

  return <span ref={ref}>0{suffix}</span>
}

export default function Trust() {
  const ref    = useRef<HTMLElement>(null)
  const inView = useInView(ref, { once: true, margin: '-10%' })

  return (
    <section ref={ref} className="py-24 px-6 border-t border-w-border">
      <div className="max-w-7xl mx-auto">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-px bg-w-border rounded-2xl overflow-hidden">
          {stats.map(({ value, suffix, label }, i) => (
            <motion.div
              key={label}
              initial={{ opacity: 0 }}
              animate={inView ? { opacity: 1 } : {}}
              transition={{ duration: 0.6, ease: easeOutExpo, delay: i * 0.1 }}
              className="bg-w-bg px-6 py-10 text-center"
            >
              <p className="text-[#F5A623] text-5xl font-black tracking-tightest leading-none mb-2">
                {inView ? <Counter target={value} suffix={suffix} /> : `0${suffix}`}
              </p>
              <p className="text-w-subtle text-xs uppercase tracking-wider">{label}</p>
            </motion.div>
          ))}
        </div>

        <motion.p
          initial={{ opacity: 0 }}
          animate={inView ? { opacity: 1 } : {}}
          transition={{ duration: 0.7, ease: easeOutExpo, delay: 0.5 }}
          className="text-center text-w-subtle text-xs mt-6"
        >
          Figures based on planned operating model · Launching Amman, Jordan
        </motion.p>
      </div>
    </section>
  )
}
