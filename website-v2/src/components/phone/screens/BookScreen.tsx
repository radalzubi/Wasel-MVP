import { useState } from 'react'
import { motion } from 'framer-motion'

interface Props { onNext: () => void; onBack: () => void }

const tiers = [
  { id: 'economy',  label: 'Economy',  fare: '1.80', eta: '4 min',  seats: 4 },
  { id: 'comfort',  label: 'Comfort',  fare: '2.50', eta: '6 min',  seats: 4 },
  { id: 'premium',  label: 'Premium',  fare: '4.00', eta: '8 min',  seats: 4 },
]

export default function BookScreen({ onNext, onBack }: Props) {
  const [selected, setSelected] = useState('economy')
  const tier = tiers.find(t => t.id === selected)!

  return (
    <div className="flex flex-col h-full bg-[#0C0C0E]">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 pt-3 pb-2">
        <button
          onClick={onBack}
          className="w-7 h-7 rounded-full bg-white/[0.06] flex items-center justify-center active:scale-90 transition-transform"
        >
          <svg className="w-3.5 h-3.5 text-white/60" fill="none" viewBox="0 0 16 16">
            <path d="M10 12L6 8L10 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
        <span className="text-white text-sm font-semibold">Book Ride</span>
      </div>

      {/* Route summary */}
      <div className="mx-4 bg-white/[0.03] border border-white/[0.06] rounded-xl px-3.5 py-3 space-y-2.5">
        <div className="flex items-center gap-2.5">
          <div className="w-2 h-2 rounded-full bg-[#F5A623] flex-shrink-0" />
          <span className="text-white/70 text-xs">Abdali, Amman</span>
        </div>
        <div className="ml-[3px] w-px h-3 bg-white/10 ml-[3.5px]" />
        <div className="flex items-center gap-2.5">
          <div className="w-2 h-2 rounded-full bg-[#4ADE80] flex-shrink-0" />
          <span className="text-white text-xs font-medium">Abdoun Circle</span>
        </div>
      </div>

      {/* Tier selector */}
      <div className="mt-3 px-4 space-y-1.5">
        <p className="text-white/30 text-[10px] font-medium tracking-widest uppercase mb-2">Select tier</p>
        {tiers.map(t => (
          <button
            key={t.id}
            onClick={() => setSelected(t.id)}
            className={[
              'w-full flex items-center justify-between px-3.5 py-3 rounded-xl border transition-all active:scale-[0.98]',
              selected === t.id
                ? 'bg-[#F5A623]/10 border-[#F5A623]/40'
                : 'bg-white/[0.03] border-white/[0.06] hover:bg-white/[0.05]',
            ].join(' ')}
          >
            <div className="flex items-center gap-2.5">
              <div className={[
                'w-2 h-2 rounded-full',
                selected === t.id ? 'bg-[#F5A623]' : 'bg-white/20',
              ].join(' ')} />
              <span className={'text-xs font-semibold ' + (selected === t.id ? 'text-white' : 'text-white/60')}>
                {t.label}
              </span>
            </div>
            <div className="text-right">
              <span className={'text-xs font-bold ' + (selected === t.id ? 'text-[#F5A623]' : 'text-white/50')}>
                JD {t.fare}
              </span>
              <span className="text-white/25 text-[10px] ml-1.5">{t.eta}</span>
            </div>
          </button>
        ))}
      </div>

      {/* Fare breakdown */}
      <motion.div
        key={selected}
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        className="mx-4 mt-3 bg-white/[0.03] border border-white/[0.05] rounded-xl px-3.5 py-3 flex items-center justify-between"
      >
        <div>
          <p className="text-white/40 text-[10px]">Estimated fare</p>
          <p className="text-white text-sm font-bold mt-0.5">JD {tier.fare}</p>
        </div>
        <div className="text-right">
          <p className="text-white/40 text-[10px]">ETA</p>
          <p className="text-white/80 text-sm font-semibold mt-0.5">{tier.eta}</p>
        </div>
        <div className="text-right">
          <p className="text-white/40 text-[10px]">Commission</p>
          <p className="text-[#4ADE80] text-sm font-bold mt-0.5">JD 0.00</p>
        </div>
      </motion.div>

      {/* CTA */}
      <div className="mt-auto px-4 pb-4 pt-3">
        <button
          onClick={onNext}
          className="w-full bg-[#F5A623] text-black text-sm font-bold rounded-xl py-3.5 active:scale-[0.97] transition-transform hover:bg-[#FFD166]"
        >
          Request {tier.label}
        </button>
        <p className="text-center text-white/20 text-[10px] mt-2">No surge pricing. Ever.</p>
      </div>
    </div>
  )
}
