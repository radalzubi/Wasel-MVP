import { motion } from 'framer-motion'

interface Props { onNext: () => void }

// Abstract street-grid map — no API key needed, looks realistic
function MapBg() {
  return (
    <svg
      className="absolute inset-0 w-full h-full"
      viewBox="0 0 320 480"
      fill="none"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden
    >
      <rect width="320" height="480" fill="#0C0C0E" />
      {/* Block fills */}
      <rect x="0"   y="0"   width="90"  height="75"  fill="#111113" />
      <rect x="110" y="0"   width="80"  height="60"  fill="#111113" />
      <rect x="210" y="0"   width="110" height="75"  fill="#0F0F11" />
      <rect x="0"   y="95"  width="70"  height="90"  fill="#111113" />
      <rect x="90"  y="80"  width="100" height="100" fill="#0F0F11" />
      <rect x="210" y="95"  width="110" height="80"  fill="#111113" />
      <rect x="0"   y="205" width="80"  height="100" fill="#0F0F11" />
      <rect x="100" y="200" width="90"  height="90"  fill="#111113" />
      <rect x="210" y="195" width="110" height="100" fill="#0F0F11" />
      {/* Major roads */}
      <rect x="0"   y="75"  width="320" height="16" fill="#1A1A1D" />
      <rect x="0"   y="185" width="320" height="14" fill="#1A1A1D" />
      <rect x="0"   y="295" width="320" height="16" fill="#1A1A1D" />
      <rect x="90"  y="0"   width="16"  height="480" fill="#1A1A1D" />
      <rect x="200" y="0"   width="14"  height="480" fill="#1A1A1D" />
      {/* Minor roads */}
      <rect x="0"   y="135" width="320" height="8"  fill="#161618" />
      <rect x="0"   y="245" width="320" height="8"  fill="#161618" />
      <rect x="40"  y="0"   width="8"   height="480" fill="#161618" />
      <rect x="150" y="0"   width="8"   height="480" fill="#161618" />
      <rect x="260" y="0"   width="8"   height="480" fill="#161618" />
      {/* Route line — amber */}
      <path
        d="M 98 400 L 98 280 Q 98 240 130 220 L 210 220"
        stroke="#F5A623"
        strokeWidth="3"
        strokeDasharray="6 4"
        strokeLinecap="round"
        opacity="0.7"
      />
      {/* Pickup pin */}
      <circle cx="98" cy="400" r="6" fill="#F5A623" />
      <circle cx="98" cy="400" r="10" fill="#F5A623" fillOpacity="0.25" />
      {/* Destination pin */}
      <circle cx="210" cy="220" r="6" fill="#4ADE80" />
      <circle cx="210" cy="220" r="10" fill="#4ADE80" fillOpacity="0.2" />
    </svg>
  )
}

export default function HomeScreen({ onNext }: Props) {
  return (
    <div className="relative w-full h-full flex flex-col overflow-hidden bg-[#0C0C0E]">
      <MapBg />

      {/* Top status area */}
      <div className="relative z-10 px-4 pt-3 flex items-center justify-between">
        <div>
          <p className="text-white/40 text-[10px] font-medium tracking-wide">GOOD MORNING</p>
          <p className="text-white text-sm font-semibold mt-0.5 leading-none">Abdali, Amman</p>
        </div>
        <div className="w-7 h-7 rounded-full bg-[#F5A623]/20 border border-[#F5A623]/30 flex items-center justify-center">
          <span className="text-[#F5A623] text-[10px] font-bold">AK</span>
        </div>
      </div>

      {/* Bottom card */}
      <div className="relative z-10 mt-auto mx-3 mb-3 bg-[#0F0F11]/95 backdrop-blur-md border border-white/[0.07] rounded-2xl p-3 shadow-2xl">
        {/* Search field */}
        <button
          onClick={onNext}
          className="w-full flex items-center gap-2.5 bg-white/[0.05] hover:bg-white/[0.09] border border-white/[0.06] rounded-xl px-3 py-3 transition-colors active:scale-[0.98] group"
        >
          <div className="w-5 h-5 rounded-full bg-[#F5A623]/15 border border-[#F5A623]/30 flex items-center justify-center flex-shrink-0">
            <div className="w-1.5 h-1.5 rounded-full bg-[#F5A623]" />
          </div>
          <span className="text-white/40 text-xs font-medium flex-1 text-left">Where to?</span>
          <svg className="w-3.5 h-3.5 text-white/20 group-hover:text-white/40 transition-colors" fill="none" viewBox="0 0 16 16">
            <path d="M6 12L10 8L6 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>

        {/* Recent destinations */}
        <div className="mt-2.5 space-y-0.5">
          {[
            { name: 'Abdoun Circle', sub: '4.1 km away' },
            { name: 'The Boulevard', sub: '6.8 km away' },
          ].map(({ name, sub }) => (
            <button
              key={name}
              onClick={onNext}
              className="w-full flex items-center gap-3 px-2 py-2 rounded-lg hover:bg-white/[0.04] transition-colors active:scale-[0.98] text-left"
            >
              <div className="w-7 h-7 rounded-full bg-white/[0.05] flex items-center justify-center flex-shrink-0">
                <svg className="w-3.5 h-3.5 text-white/30" fill="none" viewBox="0 0 16 16">
                  <circle cx="8" cy="7" r="3" stroke="currentColor" strokeWidth="1.5"/>
                  <path d="M8 1v2M8 11v2M1 7h2M11 7h2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                </svg>
              </div>
              <div>
                <p className="text-white/80 text-xs font-medium leading-none">{name}</p>
                <p className="text-white/30 text-[10px] mt-0.5">{sub}</p>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
