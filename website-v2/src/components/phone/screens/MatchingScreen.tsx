import { useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'

interface Props { onNext: () => void; onBack: () => void }

const statusLines = [
  'Scanning nearby drivers...',
  'Checking driver ratings...',
  'Matching by proximity & merit...',
  'Driver found — connecting...',
]

const PulseRing = ({ delay }: { delay: number }) => (
  <motion.div
    className="absolute inset-0 rounded-full border border-[#F5A623]/30"
    animate={{ scale: [1, 1.8, 2.2], opacity: [0.6, 0.2, 0] }}
    transition={{ duration: 2.4, delay, repeat: Infinity, ease: 'easeOut' }}
  />
)

export default function MatchingScreen({ onNext, onBack }: Props) {
  const [step, setStep] = useState(0)
  const timerRef = useRef<ReturnType<typeof setTimeout>>()

  useEffect(() => {
    if (step < statusLines.length - 1) {
      timerRef.current = setTimeout(() => setStep(s => s + 1), 1100)
    } else {
      timerRef.current = setTimeout(onNext, 900)
    }
    return () => clearTimeout(timerRef.current)
  }, [step])

  // Reset on mount
  useEffect(() => { setStep(0) }, [])

  return (
    <div className="flex flex-col h-full bg-[#0C0C0E] items-center">
      {/* Header */}
      <div className="w-full flex items-center gap-3 px-4 pt-3 pb-2">
        <button
          onClick={onBack}
          className="w-7 h-7 rounded-full bg-white/[0.06] flex items-center justify-center active:scale-90 transition-transform"
        >
          <svg className="w-3.5 h-3.5 text-white/60" fill="none" viewBox="0 0 16 16">
            <path d="M10 12L6 8L10 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
        <span className="text-white text-sm font-semibold">Finding your driver</span>
      </div>

      {/* Pulse animation */}
      <div className="flex-1 flex flex-col items-center justify-center gap-6">
        <div className="relative w-24 h-24 flex items-center justify-center">
          <PulseRing delay={0} />
          <PulseRing delay={0.8} />
          <PulseRing delay={1.6} />
          <div className="relative w-16 h-16 rounded-full bg-[#F5A623]/10 border border-[#F5A623]/30 flex items-center justify-center">
            <svg className="w-7 h-7 text-[#F5A623]" viewBox="0 0 24 24" fill="none">
              <path d="M5 17H3a2 2 0 01-2-2V5a2 2 0 012-2h11a2 2 0 012 2v3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              <rect x="9" y="11" width="14" height="10" rx="2" stroke="currentColor" strokeWidth="1.5"/>
              <circle cx="12" cy="16" r="1" fill="currentColor"/>
              <circle cx="20" cy="16" r="1" fill="currentColor"/>
            </svg>
          </div>
        </div>

        {/* Status text */}
        <div className="h-8 flex items-center">
          <AnimatePresence mode="wait">
            <motion.p
              key={step}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.3 }}
              className="text-white/50 text-xs text-center"
            >
              {statusLines[step]}
            </motion.p>
          </AnimatePresence>
        </div>

        {/* Progress dots */}
        <div className="flex gap-1.5">
          {statusLines.map((_, i) => (
            <div
              key={i}
              className={[
                'w-1.5 h-1.5 rounded-full transition-all duration-300',
                i <= step ? 'bg-[#F5A623]' : 'bg-white/15',
              ].join(' ')}
            />
          ))}
        </div>
      </div>

      {/* Cancel */}
      <div className="px-4 pb-4 w-full">
        <button
          onClick={onBack}
          className="w-full py-3 text-white/30 text-xs border border-white/[0.06] rounded-xl hover:border-white/10 hover:text-white/50 transition-all active:scale-[0.97]"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}
