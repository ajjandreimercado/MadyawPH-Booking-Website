import { useRef, useState } from 'react';
import { useScroll } from '../../hooks/useScroll';
import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'motion/react';
import { Menu, X } from 'lucide-react';
import { madyawLogoUrl } from '../../lib/branding';
import { useOnClickOutside } from '../../hooks/useOnClickOutside';

const NAV_LINKS = [
  { label: 'Browse Stays', path: '/search' },
  { label: 'Hotels Near Me', path: '/search?near=1' },
  { label: 'Help', path: '/help' },
  { label: 'Contact', path: '/contact' },
] as const;

export default function Navbar() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const scrolled = useScroll(20);
  const navRef = useRef<HTMLElement>(null);
  const navigate = useNavigate();

  useOnClickOutside(navRef, () => {
    setMobileMenuOpen(false);
  });

  const handleMobileNav = (path: string) => {
    setMobileMenuOpen(false);
    navigate(path);
  };

  const linkClass =
    'text-[10px] font-bold tracking-widest uppercase transition-colors text-brand-cream/80 hover:text-brand-gold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-gold focus-visible:ring-offset-2 focus-visible:ring-offset-brand-dark rounded-sm';

  return (
    <nav
      ref={navRef}
      className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
        scrolled && !mobileMenuOpen ? '-translate-y-full' : 'translate-y-0'
      } ${mobileMenuOpen ? 'bg-brand-dark/95 shadow-md py-5' : 'bg-brand-dark/80 backdrop-blur-md py-6'}`}
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex justify-between items-center">
        <Link
          to="/"
          className="flex items-center gap-3 group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary focus-visible:ring-offset-2 focus-visible:ring-offset-brand-dark rounded-2xl"
        >
          <img
            src={madyawLogoUrl}
            alt="Madyaw logo"
            className="h-12 w-12 rounded-2xl bg-brand-cream p-1.5 object-contain shadow-sm ring-1 ring-white/10"
          />
          <span className="text-2xl font-display italic font-semibold tracking-tight text-brand-cream">Madyaw</span>
        </Link>

        <div className="hidden md:flex items-center gap-10">
          {NAV_LINKS.map(({ label, path }) => (
            <Link key={path} to={path} className={linkClass}>
              {label}
            </Link>
          ))}
        </div>

        <button
          type="button"
          aria-label={mobileMenuOpen ? 'Close mobile navigation menu' : 'Open mobile navigation menu'}
          aria-expanded={mobileMenuOpen}
          aria-controls="mobile-menu"
          className="md:hidden p-2 text-current focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary focus-visible:ring-offset-2 focus-visible:ring-offset-brand-dark"
          onClick={() => setMobileMenuOpen((prev) => !prev)}
        >
          {mobileMenuOpen ? <X className="w-6 h-6 text-brand-cream" /> : <Menu className="w-6 h-6 text-brand-cream" />}
        </button>
      </div>

      {mobileMenuOpen && (
        <motion.div
          id="mobile-menu"
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          transition={{ duration: 0.2, ease: 'easeInOut' }}
          className="md:hidden border-t border-brand-primary/10 bg-brand-cream absolute top-full left-0 right-0 shadow-md overflow-hidden"
        >
          <div className="px-4 py-6 flex flex-col gap-4">
            {NAV_LINKS.map(({ label, path }) => (
              <button
                key={path}
                type="button"
                className="text-left text-lg font-serif text-brand-dark hover:text-brand-primary font-bold"
                onClick={() => handleMobileNav(path)}
              >
                {label}
              </button>
            ))}
          </div>
        </motion.div>
      )}
    </nav>
  );
}
