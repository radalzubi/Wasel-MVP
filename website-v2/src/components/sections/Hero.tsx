import { useRef, useEffect } from 'react'
import { motion, useMotionValue, useTransform, useSpring } from 'framer-motion'
import AppPreview from '../phone/AppPreview'
import { easeOutExpo } from '../../lib/utils'

export default function Hero() {
  const phoneRef = useRef<HTMLDivElement>(null)
  const rawX     = useMotionValue(0)
  const rawY     = useMotionValue(0)
  const springX  = useSpring(rawX, { stiffness: 80, damping: 20 })
  const springY  = useSpring(rawY, { stiffness: 80, damping: 20 })
  const rotateX  = useTransform(springY, [-0.5, 0.5], [6, -6])
  const rotateY  = useTransform(springX, [-0.5, 0.5], [-7, 7])

  useEffect(() => {
    const el = phoneRef.current
    if (!el) return
    const onMove = (e: MouseEvent) => {
      const r = el.getBoundingClientRect()
      rawX.set((e.clientX - r.left) / r.width  - 0.5)
      rawY.set((e.clientY - r.top)  / r.height - 0.5)
    }
    const onLeave = () => { rawX.set(0); rawY.set(0) }
    el.addEventListener('mousemove', onMove)
    el.addEventListener('mouseleave', onLeave)
    return () => { el.removeEventListener('mousemove', onMove); el.removeEventListener('mouseleave', onLeave) }
  }, [])

  return (
    <section className="relative min-h-screen flex flex-col items-center justify-center pt-24 pb-16 px-6 overflow-hidden">
      {/* Ambient glow */}
      <div
        className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full pointer-events-none"
        style={{
          background: 'radial-gradient(circle, rgba(245,166,35,0.07) 0%, transparent 70%)',
          filter: 'blur(40px)',
        }}
      />

      {/* Copy */}
      <div className="relative z-10 text-center max-w-3xl mx-auto">
        <motion.p
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, ease: easeOutExpo, delay: 0.1 }}
          className="section-overline mb-8"
        >
          Coming to Amman
        </motion.p>

        <motion.h1
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.9, ease: easeOutExpo, delay: 0.2 }}
          className="text-[clamp(56px,10vw,112px)] font-black tracking-tightest text-w-text leading-[0.92] mb-8"
        >
          The ride<br />that pays.
        </motion.h1>

        <motion.p
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: easeOutExpo, delay: 0.35 }}
          className="text-w-muted text-lg leading-relaxed max-w-xl mx-auto mb-10"
        >
          Jordan's first subscription rideshare.
          Drivers keep 100% of every fare.
          Riders pay honest, flat prices.
        </motion.p>

        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, ease: easeOutExpo, delay: 0.48 }}
          className="flex flex-wrap items-center justify-center gap-3"
        >
          <a href="#waitlist" className="btn-primary px-8 py-3.5 text-sm">
            Get early access
          </a>
          <a href="#preview" className="btn-secondary px-8 py-3.5 text-sm">
            See the app
          </a>
        </motion.div>
      </div>

      {/* Phone mockup */}
      <motion.div
        ref={phoneRef}
        initial={{ opacity: 0, y: 60 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 1.1, ease: easeOutExpo, delay: 0.5 }}
        style={{ rotateX, rotateY, transformPerspective: 1200, transformStyle: 'preserve-3d' }}
        className="relative z-10 mt-12"
      >
        {/* Glow under phone */}
        <div
          className="absolute -bottom-8 left-1/2 -translate-x-1/2 w-48 h-12 pointer-events-none"
          style={{
            background: 'radial-gradient(ellipse, rgba(245,166,35,0.25) 0%, transparent 70%)',
            filter: 'blur(16px)',
          }}
        />
        <AppPreview />
      </motion.div>

      {/* Scroll hint */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 1.8, duration: 0.8 }}
        className="absolute bottom-8 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2"
      >
        <span className="text-w-subtle text-[10px] tracking-widest uppercase">Scroll</span>
        <motion.div
          animate={{ y: [0, 5, 0] }}
          transition={{ duration: 1.8, repeat: Infinity, ease: 'easeInOut' }}
          className="w-px h-5 bg-gradient-to-b from-w-subtle to-transparent"
        />
      </motion.div>
    </section>
  )
}
