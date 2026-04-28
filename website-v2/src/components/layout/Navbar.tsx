import { useEffect, useRef, useState } from 'react'
import { motion, useScroll, useTransform } from 'framer-motion'

const links = [
  { label: 'Riders',  href: '#riders'   },
  { label: 'Drivers', href: '#drivers'  },
  { label: 'Pricing', href: '#pricing'  },
]

export default function Navbar() {
  const [hidden, setHidden]     = useState(false)
  const [atTop,  setAtTop]      = useState(true)
  const lastY = useRef(0)

  useEffect(() => {
    const onScroll = () => {
      const y = window.scrollY
      setAtTop(y < 40)
      setHidden(y > lastY.current && y > 100)
      lastY.current = y
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  return (
    <motion.header
      animate={{ y: hidden ? -80 : 0 }}
      transition={{ duration: 0.4, ease: [0.4, 0, 0.2, 1] }}
      className={[
        'fixed top-0 inset-x-0 z-50 flex items-center justify-between',
        'px-6 md:px-12 h-16',
        atTop
          ? 'bg-transparent'
          : 'bg-w-bg/90 backdrop-blur-xl border-b border-w-border',
        'transition-colors duration-300',
      ].join(' ')}
    >
      {/* Logo */}
      <a
        href="#"
        className="text-w-amber text-2xl font-black tracking-tighter leading-none select-none"
        aria-label="Wasel home"
      >
        واصل
      </a>

      {/* Links */}
      <nav className="hidden md:flex items-center gap-8">
        {links.map(({ label, href }) => (
          <a
            key={label}
            href={href}
            className="text-w-muted text-sm font-medium hover:text-w-text transition-colors duration-200"
          >
            {label}
          </a>
        ))}
      </nav>

      {/* CTA */}
      <a href="#waitlist" className="btn-primary text-xs px-5 py-2.5">
        Join Waitlist
      </a>
    </motion.header>
  )
}
