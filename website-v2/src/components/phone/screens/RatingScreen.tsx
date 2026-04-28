import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'

interface Props { onBack: () => void }

export default function RatingScreen({ onBack }: Props) {
  const [stars,      setStars]      = useState(0)
  const [submitted,  setSubmitted]  = useState(false)
  const [hovered,    setHovered]    = useState(0)

  const handleSubmit = () => {
    if (stars > 0) setSubmitted(true)
  }

  return (
    <div className="flex flex-col h-full bg-[#0C0C0E] items-center">
      <AnimatePresence mode="wait">
        {!submitted ? (
          <motion.div
            key="rating"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            className="flex flex-col h-full w-full items-center"
          >
            {/* Checkmark */}
            <div className="flex-1 flex flex-col items-center justify-center gap-4 px-6">
              <motion.div
                initial={{ scale: 0.5, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ type: 'spring', stiffness: 200, damping: 15 }}
                className="w-16 h-16 rounded-full bg-[#4ADE80]/10 border border-[#4ADE80]/30 flex items-center justify-center"
              >
                <svg className="w-8 h-8 text-[#4ADE80]" fill="none" viewBox="0 0 24 24">
                  <path d="M5 13l4 4L19 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </motion.div>

              <div className="text-center">
                <p className="text-white text-lg font-bold tracking-tight">Trip complete</p>
                <p className="text-white/40 text-xs mt-1">Abdali → Abdoun Circle</p>
              </div>

              {/* Fare summary */}
              <div className="w-full bg-white/[0.03] border border-white/[0.06] rounded-xl px-4 py-3 flex justify-between items-center">
                <div>
                  <p className="text-white/40 text-[10px]">Fare paid</p>
                  <p className="text-white text-sm font-bold mt-0.5">JD 2.50</p>
                </div>
                <div className="text-right">
                  <p className="text-white/40 text-[10px]">Duration</p>
                  <p className="text-white/80 text-sm font-semibold mt-0.5">14 min</p>
                </div>
                <div className="text-right">
                  <p className="text-white/40 text-[10px]">Driver earned</p>
                  <p className="text-[#4ADE80] text-sm font-bold mt-0.5">JD 2.50</p>
                </div>
              </div>

              {/* Stars */}
              <div className="w-full">
                <p className="text-white/50 text-xs text-center mb-3">How was Ahmad?</p>
                <div className="flex justify-center gap-3">
                  {[1,2,3,4,5].map(n => (
                    <button
                      key={n}
                      onMouseEnter={() => setHovered(n)}
                      onMouseLeave={() => setHovered(0)}
                      onClick={() => setStars(n)}
                      className="transition-transform active:scale-90"
                    >
                      <motion.svg
                        animate={{ scale: n <= (hovered || stars) ? 1.15 : 1 }}
                        className="w-8 h-8"
                        viewBox="0 0 24 24"
                        fill={n <= (hovered || stars) ? '#F5A623' : 'none'}
                        stroke={n <= (hovered || stars) ? '#F5A623' : '#444'}
                        strokeWidth="1.5"
                      >
                        <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
                      </motion.svg>
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Submit */}
            <div className="px-4 pb-4 w-full">
              <button
                onClick={handleSubmit}
                disabled={stars === 0}
                className={[
                  'w-full py-3.5 rounded-xl text-sm font-bold transition-all active:scale-[0.97]',
                  stars > 0
                    ? 'bg-[#F5A623] text-black hover:bg-[#FFD166]'
                    : 'bg-white/[0.05] text-white/30 cursor-not-allowed',
                ].join(' ')}
              >
                {stars > 0 ? 'Submit Rating' : 'Tap a star'}
              </button>
            </div>
          </motion.div>
        ) : (
          <motion.div
            key="done"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="flex flex-col h-full items-center justify-center gap-4 px-6"
          >
            <div className="w-14 h-14 rounded-full bg-[#F5A623]/10 border border-[#F5A623]/30 flex items-center justify-center">
              <span className="text-2xl font-black text-[#F5A623]">{stars}</span>
            </div>
            <div className="text-center">
              <p className="text-white text-base font-bold">Thank you</p>
              <p className="text-white/40 text-xs mt-1">Your rating helps Ahmad earn more rides</p>
            </div>
            <button
              onClick={onBack}
              className="mt-4 text-w-amber text-xs border border-[#F5A623]/30 px-6 py-2 rounded-full hover:bg-[#F5A623]/10 transition-colors"
            >
              Book another ride
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
