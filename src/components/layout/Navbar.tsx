import { useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'motion/react';
import { Menu, X, User } from 'lucide-react';
import { madyawLogoUrl } from '../../lib/branding';
import { useOnClickOutside } from '../../hooks/useOnClickOutside';
import { useAuth } from '../../contexts/AuthContext';
import { useAuthModal } from '../../contexts/AuthModalContext';

const NAV_LINKS = [
  { label: 'Browse Stays', path: '/search' },
  { label: 'Hotels Near Me', path: '/search?near=1' },
  { label: 'Help', path: '/help' },
  { label: 'Contact', path: '/contact' },
] as const;

export default function Navbar() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const navRef = useRef<HTMLElement>(null);
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const { openAuthModal } = useAuthModal();

  useOnClickOutside(navRef, () => {
    setMobileMenuOpen(false);
    setAccountOpen(false);
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
      className="fixed top-0 left-0 right-0 z-50 h-[4.5rem] sm:h-20 bg-brand-dark shadow-md"
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-full flex justify-between items-center gap-3">
        <Link
          to="/"
          className="flex items-center gap-3 shrink-0 group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary focus-visible:ring-offset-2 focus-visible:ring-offset-brand-dark rounded-2xl"
        >
          <img
            src={madyawLogoUrl}
            alt="Madyaw logo"
            className="h-10 w-10 sm:h-12 sm:w-12 rounded-2xl bg-brand-cream p-1.5 object-contain shadow-sm ring-1 ring-white/10"
          />
          <span className="text-xl sm:text-2xl font-display italic font-semibold tracking-tight text-brand-cream whitespace-nowrap">Madyaw</span>
        </Link>

        <div className="hidden min-[880px]:flex items-center gap-6 lg:gap-10">
          {NAV_LINKS.map(({ label, path }) => (
            <Link key={path} to={path} className={linkClass}>
              {label}
            </Link>
          ))}
          {user ? (
            <>
              <Link to="/trips" className={linkClass}>
                My trips
              </Link>
              <div className="relative">
                <button
                  type="button"
                  aria-expanded={accountOpen}
                  aria-haspopup="menu"
                  onClick={() => setAccountOpen((v) => !v)}
                  className="flex items-center gap-2 rounded-xl border border-brand-cream/20 bg-brand-cream/5 px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-brand-cream hover:border-brand-gold/50 hover:text-brand-gold transition-colors"
                >
                  {user.avatar ? (
                    <img src={user.avatar} alt="" className="h-5 w-5 rounded-full object-cover" />
                  ) : (
                    <User className="h-3.5 w-3.5" />
                  )}
                  <span className="max-w-[9rem] truncate">{user.name || 'Account'}</span>
                </button>
                {accountOpen ? (
                  <div
                    role="menu"
                    className="absolute right-0 mt-2 w-52 rounded-xl border border-brand-primary/10 bg-brand-cream shadow-lg py-2 z-50"
                  >
                    <p className="px-4 py-1.5 text-[10px] font-bold uppercase tracking-widest text-brand-dark/45 truncate">
                      {user.email}
                    </p>
                    <button
                      type="button"
                      role="menuitem"
                      className="w-full text-left px-4 py-2.5 text-sm font-bold text-brand-dark hover:bg-brand-primary/5"
                      onClick={() => {
                        setAccountOpen(false);
                        navigate('/trips');
                      }}
                    >
                      My trips
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      className="w-full text-left px-4 py-2.5 text-sm font-bold text-brand-dark hover:bg-brand-primary/5"
                      onClick={() => {
                        setAccountOpen(false);
                        void logout();
                      }}
                    >
                      Sign out
                    </button>
                  </div>
                ) : null}
              </div>
            </>
          ) : (
            <button
              type="button"
              onClick={() => openAuthModal({ mode: 'login' })}
              className="rounded-xl bg-brand-gold px-4 py-2 text-[10px] font-bold uppercase tracking-widest text-brand-dark hover:brightness-105 transition-all"
            >
              Sign in
            </button>
          )}
        </div>

        <button
          type="button"
          aria-label={mobileMenuOpen ? 'Close mobile navigation menu' : 'Open mobile navigation menu'}
          aria-expanded={mobileMenuOpen}
          aria-controls="mobile-menu"
          className="min-[880px]:hidden p-2 text-current focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary focus-visible:ring-offset-2 focus-visible:ring-offset-brand-dark"
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
          className="min-[880px]:hidden border-t border-brand-primary/10 bg-brand-cream absolute top-full left-0 right-0 shadow-md overflow-hidden"
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
            {user ? (
              <>
                <button
                  type="button"
                  className="text-left text-lg font-serif text-brand-dark hover:text-brand-primary font-bold"
                  onClick={() => handleMobileNav('/trips')}
                >
                  My trips
                </button>
                <button
                  type="button"
                  className="text-left text-sm font-bold text-brand-dark/70"
                  onClick={() => {
                    setMobileMenuOpen(false);
                    void logout();
                  }}
                >
                  Sign out ({user.email})
                </button>
              </>
            ) : (
              <button
                type="button"
                className="text-left text-lg font-serif text-brand-primary font-bold"
                onClick={() => {
                  setMobileMenuOpen(false);
                  openAuthModal({ mode: 'login' });
                }}
              >
                Sign in
              </button>
            )}
          </div>
        </motion.div>
      )}
    </nav>
  );
}
