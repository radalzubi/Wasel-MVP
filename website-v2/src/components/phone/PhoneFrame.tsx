import { type ReactNode } from 'react'

interface Props {
  children: ReactNode
  className?: string
}

export default function PhoneFrame({ children, className = '' }: Props) {
  return (
    <div className={"relative select-none " + className}>
      {/* Outer shell */}
      <div
        className="relative overflow-hidden"
        style={{
          width: '300px',
          height: '620px',
          borderRadius: '46px',
          background: 'linear-gradient(160deg, #1C1C1E 0%, #0D0D0F 100%)',
          border: '1.5px solid rgba(255,255,255,0.12)',
          boxShadow: [
            '0 60px 120px rgba(0,0,0,0.7)',
            '0 0 0 0.5px rgba(255,255,255,0.04)',
            'inset 0 1px 0 rgba(255,255,255,0.10)',
            'inset 0 -1px 0 rgba(0,0,0,0.5)',
          ].join(', '),
        }}
      >
        {/* Side buttons — left */}
        <div className="absolute left-[-2px] top-[110px] w-1 h-7 bg-[#2A2A2D] rounded-l-sm" />
        <div className="absolute left-[-2px] top-[148px] w-1 h-10 bg-[#2A2A2D] rounded-l-sm" />
        <div className="absolute left-[-2px] top-[200px] w-1 h-10 bg-[#2A2A2D] rounded-l-sm" />
        {/* Side button — right */}
        <div className="absolute right-[-2px] top-[140px] w-1 h-14 bg-[#2A2A2D] rounded-r-sm" />

        {/* Screen area */}
        <div
          className="absolute overflow-hidden"
          style={{
            inset: '1px',
            borderRadius: '44px',
            background: '#080808',
          }}
        >
          {/* Notch / Dynamic Island */}
          <div
            className="absolute top-3 left-1/2 -translate-x-1/2 z-50"
            style={{
              width: '96px',
              height: '26px',
              borderRadius: '13px',
              background: '#000',
            }}
          />

          {/* Status bar */}
          <div className="absolute top-0 inset-x-0 h-12 z-40 flex items-start justify-between px-6 pt-3">
            <span className="text-white/60 text-[10px] font-semibold">9:41</span>
            <div className="flex items-center gap-1.5 mt-0.5">
              {/* Signal */}
              <svg className="w-3 h-3 text-white/60" viewBox="0 0 12 12" fill="currentColor">
                <rect x="0" y="7" width="2" height="5" rx="0.5" />
                <rect x="3" y="5" width="2" height="7" rx="0.5" />
                <rect x="6" y="3" width="2" height="9" rx="0.5" />
                <rect x="9" y="1" width="2" height="11" rx="0.5" />
              </svg>
              {/* WiFi */}
              <svg className="w-3.5 h-3 text-white/60" viewBox="0 0 14 10" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round">
                <path d="M1 3.5C3.5 1 10.5 1 13 3.5"/>
                <path d="M3 6C5 4.2 9 4.2 11 6"/>
                <path d="M5.5 8.5C6.3 7.8 7.7 7.8 8.5 8.5"/>
                <circle cx="7" cy="10" r="0.5" fill="currentColor"/>
              </svg>
              {/* Battery */}
              <svg className="w-5 h-3 text-white/60" viewBox="0 0 20 12" fill="none">
                <rect x="0.5" y="0.5" width="16" height="11" rx="2.5" stroke="currentColor" strokeWidth="1"/>
                <rect x="17" y="3.5" width="2.5" height="5" rx="1.25" fill="currentColor" opacity="0.5"/>
                <rect x="2" y="2" width="11" height="8" rx="1.5" fill="currentColor" opacity="0.8"/>
              </svg>
            </div>
          </div>

          {/* Demo label — top right subtle */}
          <div className="absolute top-14 right-3 z-50">
            <span className="text-white/15 text-[8px] font-medium tracking-wider uppercase bg-white/5 px-1.5 py-0.5 rounded">
              DEMO
            </span>
          </div>

          {/* Content */}
          <div className="absolute inset-0 overflow-hidden phone-demo-shell">
            {children}
          </div>
        </div>
      </div>

      {/* Reflection highlight */}
      <div
        className="absolute pointer-events-none"
        style={{
          top: '2px',
          left: '12px',
          right: '12px',
          height: '60px',
          borderRadius: '44px 44px 0 0',
          background: 'linear-gradient(180deg, rgba(255,255,255,0.06) 0%, transparent 100%)',
        }}
      />
    </div>
  )
}
