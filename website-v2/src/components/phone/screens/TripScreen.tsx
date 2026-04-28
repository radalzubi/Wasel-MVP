import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'

interface Props { onNext: () => void }

function MapBg() {
  return (
    <svg className="absolute inset-0 w-full h-full" viewBox="0 0 320 260" fill="none" preserveAspectRatio="xMidYMid slice" aria-hidden>
      <rect width="320" height="260" fill="#0C0C0E" />
      <rect x="0"   y="0"   width="90"  height="75"  fill="#111113" />
      <rect x="110" y="0"   width="80"  height="60"  fill="#111113" />
      <rect x="210" y="0"   width="110" height="75"  fill="#0F0F11" />
      <rect x="0"   y="95"  width="70"  height="160" fill="#111113" />
      <rect x="90"  y="80"  width="100" height="180" fill="#0F0F11" />
      <rect x="210" y="95"  width="110" height="165" fill="#111113" />
      <rect x="0"   y="75"  width="320" height="14"  fill="#1A1A1D" />
      <rect x="0"   y="185" width="320" height="12"  fill="#1A1A1D" />
      <rect x="90"  y="0"   width="14"  height="260" fill="#1A1A1D" />
      <rect x="200" y="0"   width="12"  height="260" fill="#1A1A1D" />
      <path d="M 150 50 L 150 180 Q 150 200 170 210 L 210 210" stroke="#F5A623" strokeWidth="3" opacity="0.5" strokeLinecap="round"/>
      {/* Animated car position */}
      <circle cx="150" cy="80" r="5" fill="#F5A623" />
      <circle cx="150" cy="80" r="9" fill="#F5A623" fillOpacity="0.2" />
      <circle cx="210" cy="210" r="5" fill="#4ADE80" />
      <circle cx="210" cy="210" r="9" fill="#4ADE80" fillOpacity="0.2" />
    </svg>
  )
}

export default function TripScreen({ onNext }: Props) {
  const [eta, setEta] = useState(4)

  useEffect(() => {
    const t = setInterval(() => {
      setEta(e => {
        if (e <= 1) { clearInterval(t); setTimeout(onNext, 600); return 0 }
        return e - 1
      })
    }, 1400)
    return () => clearInterval(t)
  }, [])

  return (
    <div className="flex flex-col h-full bg-[#0C0C0E]">
      {/* Map */}
      <div className="relative flex-1 overflow-hidden">
        <MapBg />
        {/* Driver info overlay top */}
        <div className="absolute top-3 inset-x-3 bg-[#0F0F11]/90 backdrop-blur border border-white/[0.07] rounded-xl px-3.5 py-2.5 flex items-center gap-3">
          <div className="w-9 h-9 rounded-full bg-[#F5A623]/15 border border-[#F5A623]/30 flex items-center justify-center flex-shrink-0">
            <span className="text-[#F5A623] text-[11px] font-bold">AK</span>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-white text-xs font-semibold leading-none">Ahmad K.</p>
            <p className="text-white/40 text-[10px] mt-0.5">Toyota Camry · White · 3297</p>
          </div>
          <div className="flex items-center gap-1">
            <span className="text-[#F5A623] text-[10px]">★</span>
            <span className="text-white/70 text-[10px] font-semibold">4.92</span>
          </div>
        </div>
      </div>

      {/* ETA + status card */}
      <div className="bg-[#0F0F11] border-t border-white/[0.06] px-4 py-4">
        <div className="flex items-center justify-between mb-3">
          <div>
            <p className="text-white/40 text-[10px] uppercase tracking-wider">Arriving in</p>
            <motion.p
              key={eta}
              initial={{ opacity: 0.6, scale: 0.92 }}
              animate={{ opacity: 1, scale: 1 }}
              className="text-white text-3xl font-black tracking-tighter leading-none mt-0.5"
            >
              {eta} <span className="text-lg font-medium text-white/50">min</span>
            </motion.p>
          </div>
          <div className="text-right">
            <p className="text-white/40 text-[10px] uppercase tracking-wider">Fare</p>
            <p className="text-[#F5A623] text-lg font-bold mt-0.5">JD 2.50</p>
          </div>
        </div>

        {/* Progress track */}
        <div className="bg-white/[0.05] rounded-full h-1 overflow-hidden">
          <motion.div
            className="h-full bg-[#F5A623] rounded-full"
            animate={{ width: `${100 - (eta / 4) * 100}%` }}
            transition={{ duration: 0.6, ease: 'easeOut' }}
          />
        </div>
        <p className="text-white/30 text-[10px] mt-2 text-center">Your driver is on the way</p>
      </div>
    </div>
  )
}
