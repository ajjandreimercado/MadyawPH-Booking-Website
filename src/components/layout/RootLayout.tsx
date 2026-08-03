import { useEffect } from 'react';
import { Outlet, Link, useLocation } from 'react-router-dom';
import Navbar from './Navbar';
import { motion, AnimatePresence } from 'motion/react';
import { madyawLogoUrl } from '../../lib/branding';
import SafeLink from '../ui/SafeLink';

export default function RootLayout() {
  const location = useLocation();

  // Scroll behavior: scroll to top on route change, or to anchor if hash is present
  useEffect(() => {
    const hash = location.hash;
    // Delay slightly to allow route transition animation
    const id = window.setTimeout(() => {
      if (hash) {
        try {
          const el = document.querySelector(hash);
          if (el) {
            (el as HTMLElement).scrollIntoView({ behavior: 'smooth' });
            return;
          }
        } catch {
          // Ignore invalid selector syntax
        }
      }

      window.scrollTo({ top: 0, behavior: 'smooth' });
    }, 250);

    return () => window.clearTimeout(id);
  }, [location.pathname, location.hash]);

  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />
      <AnimatePresence mode="wait">
        <motion.main
          key={location.pathname}
          aria-label="Main content"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          transition={{ duration: 0.4, ease: "easeOut" }}
          className="flex-grow flex flex-col"
        >
          <Outlet />
        </motion.main>
      </AnimatePresence>

      <footer className="border-t border-brand-primary/10 bg-brand-dark text-brand-cream mt-auto pt-16 pb-8">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-12 lg:gap-8 mb-16">
            {/* Brand Block */}
            <div className="col-span-1 md:col-span-2 lg:col-span-1">
              <Link to="/" className="flex items-center gap-4 group mb-6">
                <img
                  src={madyawLogoUrl}
                  alt="Madyaw logo"
                  className="h-12 w-12 rounded-xl bg-brand-cream p-1.5 object-contain shadow-md"
                />
                <span className="text-2xl font-serif font-bold tracking-tight text-brand-cream">Madyaw</span>
              </Link>
              <p className="text-sm leading-relaxed text-brand-cream/70 mb-6">
                Curating the finest coastal escapes and luxury sanctuaries across the Philippines. Your journey to exceptional hospitality begins here.
              </p>
              <div className="flex gap-4">
                <a href="#" className="w-10 h-10 rounded-full border border-brand-primary/20 flex items-center justify-center text-brand-cream/70 hover:bg-brand-primary/10 hover:text-brand-secondary hover:border-brand-secondary transition-all">
                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M24 4.557c-.883.392-1.832.656-2.828.775 1.017-.609 1.798-1.574 2.165-2.724-.951.564-2.005.974-3.127 1.195-.897-.957-2.178-1.555-3.594-1.555-3.179 0-5.515 2.966-4.797 6.045-4.091-.205-7.719-2.165-10.148-5.144-1.29 2.213-.669 5.108 1.523 6.574-.806-.026-1.566-.247-2.229-.616-.054 2.281 1.581 4.415 3.949 4.89-.693.188-1.452.232-2.224.084.626 1.956 2.444 3.379 4.6 3.419-2.07 1.623-4.678 2.348-7.29 2.04 2.179 1.397 4.768 2.212 7.548 2.212 9.142 0 14.307-7.721 13.995-14.646.962-.695 1.797-1.562 2.457-2.549z"/></svg>
                </a>
                <a href="#" className="w-10 h-10 rounded-full border border-brand-primary/20 flex items-center justify-center text-brand-cream/70 hover:bg-brand-primary/10 hover:text-brand-secondary hover:border-brand-secondary transition-all">
                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z"/></svg>
                </a>
              </div>
            </div>

            {/* Quick Links */}
            <div className="col-span-1">
              <h3 className="font-serif font-bold text-lg text-brand-secondary mb-4">Discover</h3>
              <ul className="space-y-3 text-sm font-bold text-brand-cream/70">
                <li><SafeLink href="/destinations" className="hover:text-brand-secondary transition-colors">Destinations</SafeLink></li>
                <li><SafeLink href="/experiences" className="hover:text-brand-secondary transition-colors">Experiences</SafeLink></li>
                <li><SafeLink href="/club" className="hover:text-brand-secondary transition-colors">The Club</SafeLink></li>
              </ul>
            </div>

            {/* Support */}
            <div className="col-span-1">
              <h3 className="font-serif font-bold text-lg text-brand-secondary mb-4">Support</h3>
              <ul className="space-y-3 text-sm font-bold text-brand-cream/70">
                <li><SafeLink href="/help" className="hover:text-brand-secondary transition-colors">Help Center</SafeLink></li>
                <li><SafeLink href="/cancellation" className="hover:text-brand-secondary transition-colors">Cancellation Options</SafeLink></li>
                <li><SafeLink href="/safety" className="hover:text-brand-secondary transition-colors">Safety Information</SafeLink></li>
                <li><SafeLink href="/contact" className="hover:text-brand-secondary transition-colors">Contact Us</SafeLink></li>
              </ul>
            </div>

            {/* Newsletter */}
            <div className="col-span-1 md:col-span-2 lg:col-span-1">
              <h3 className="font-serif font-bold text-lg text-brand-secondary mb-4">Newsletter</h3>
              <p className="text-xs text-brand-cream/70 mb-4 leading-relaxed">
                Subscribe to unlock secret deals and curated travel inspiration.
              </p>
              <form className="flex rounded-xl overflow-hidden focus-within:ring-2 focus-within:ring-brand-secondary/50">
                <input
                  type="email"
                  placeholder="Your email address"
                  className="bg-brand-primary/20 text-brand-cream text-sm px-4 py-3 w-full border-none outline-none placeholder-brand-cream/30"
                />
                <button type="button" className="bg-brand-secondary text-brand-dark px-4 font-bold text-sm hover:bg-brand-secondary/90 transition-colors">
                  Subscribe
                </button>
              </form>
            </div>
          </div>

          <div className="pt-8 border-t border-brand-primary/20 flex flex-col md:flex-row items-center justify-between gap-4 text-xs font-bold text-brand-cream/50">
            <p>© {new Date().getFullYear()} Madyaw. All rights reserved.</p>
            <div className="flex gap-6">
              <SafeLink href="/privacy" className="hover:text-brand-secondary transition-colors">Privacy Policy</SafeLink>
              <SafeLink href="/terms" className="hover:text-brand-secondary transition-colors">Terms of Service</SafeLink>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
