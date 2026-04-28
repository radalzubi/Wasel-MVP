const footerLinks = [
  { label: 'Privacy',  href: '#' },
  { label: 'Terms',    href: '#' },
  { label: 'Contact',  href: '#' },
]

export default function Footer() {
  return (
    <footer className="border-t border-w-border px-6 md:px-12 py-10">
      <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4">
        <span className="text-w-amber text-xl font-black tracking-tighter select-none">
          واصل
        </span>
        <p className="text-w-subtle text-xs">
          © 2025 Wasel Technologies — Amman, Jordan
        </p>
        <nav className="flex gap-6">
          {footerLinks.map(({ label, href }) => (
            <a
              key={label}
              href={href}
              className="text-w-subtle text-xs hover:text-w-muted transition-colors"
            >
              {label}
            </a>
          ))}
        </nav>
      </div>
    </footer>
  )
}
