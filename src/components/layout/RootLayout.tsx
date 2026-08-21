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
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-12 lg:gap-8 mb-16">
            {/* Brand Block */}
            <div className="col-span-1 md:col-span-2 lg:col-span-1">
              <Link to="/" className="flex items-center gap-4 group mb-6">
                <img
                  src={madyawLogoUrl}
                  alt="Madyaw logo"
                  className="h-12 w-12 rounded-xl bg-brand-cream p-1.5 object-contain shadow-md"
                />
                <span className="text-2xl font-display italic font-semibold tracking-tight text-brand-cream">Madyaw</span>
              </Link>
              <p className="text-sm leading-relaxed text-brand-cream/70">
                Curating the finest coastal escapes and luxury sanctuaries across the Philippines. Your journey to exceptional hospitality begins here.
              </p>
            </div>

            {/* Quick Links */}
            <div className="col-span-1">
              <h3 className="font-display font-semibold text-lg text-brand-gold mb-4">Discover</h3>
              <ul className="space-y-3 text-sm font-bold text-brand-cream/70">
                <li><SafeLink href="/search" className="hover:text-brand-gold transition-colors">Browse Stays</SafeLink></li>
                <li><SafeLink href="/search?near=1" className="hover:text-brand-gold transition-colors">Hotels Near Me</SafeLink></li>
              </ul>
            </div>

            {/* Support */}
            <div className="col-span-1 md:col-span-2 lg:col-span-2">
              <h3 className="font-display font-semibold text-lg text-brand-gold mb-4">Support</h3>
              <ul className="space-y-3 text-sm font-bold text-brand-cream/70 sm:columns-2 sm:gap-x-8">
                <li className="break-inside-avoid"><SafeLink href="/help" className="hover:text-brand-gold transition-colors">Help Center</SafeLink></li>
                <li className="break-inside-avoid"><SafeLink href="/cancellation" className="hover:text-brand-gold transition-colors">Cancellation Options</SafeLink></li>
                <li className="break-inside-avoid"><SafeLink href="/safety" className="hover:text-brand-gold transition-colors">Safety Information</SafeLink></li>
                <li className="break-inside-avoid"><SafeLink href="/contact" className="hover:text-brand-gold transition-colors">Contact Us</SafeLink></li>
              </ul>
            </div>
          </div>

          <div className="pt-8 border-t border-brand-primary/20 flex flex-col md:flex-row items-center justify-between gap-4 text-xs font-bold text-brand-cream/50">
            <p>© {new Date().getFullYear()} Madyaw. All rights reserved.</p>
            <div className="flex gap-6">
              <SafeLink href="/privacy" className="hover:text-brand-gold transition-colors">Privacy Policy</SafeLink>
              <SafeLink href="/terms" className="hover:text-brand-gold transition-colors">Terms of Service</SafeLink>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
