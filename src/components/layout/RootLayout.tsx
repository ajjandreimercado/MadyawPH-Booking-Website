import { useEffect } from 'react';
import { Outlet, Link, useLocation } from 'react-router-dom';
import Navbar from './Navbar';
import { madyawLogoUrl } from '../../lib/branding';
import SafeLink from '../ui/SafeLink';

export default function RootLayout() {
  const location = useLocation();

  useEffect(() => {
    if (location.hash) {
      try {
        const el = document.querySelector(location.hash);
        if (el) {
          (el as HTMLElement).scrollIntoView();
          return;
        }
      } catch {
        // Ignore invalid selector syntax
      }
    }
    window.scrollTo(0, 0);
  }, [location.pathname, location.hash]);

  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />
      <main aria-label="Main content" className="flex-grow flex flex-col">
        <Outlet />
      </main>

      <footer className="border-t border-brand-primary/10 bg-brand-dark text-brand-cream mt-auto pt-16 pb-8">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 min-[520px]:grid-cols-2 xl:grid-cols-4 gap-10 xl:gap-8 mb-12">
            {/* Brand Block */}
            <div className="min-[520px]:col-span-2 xl:col-span-1">
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

            <div>
              <h3 className="font-display font-semibold text-lg text-brand-gold mb-4">Discover</h3>
              <ul className="space-y-3 text-sm font-bold text-brand-cream/70">
                <li><SafeLink href="/search" className="hover:text-brand-gold transition-colors">Browse Stays</SafeLink></li>
                <li><SafeLink href="/search?near=1" className="hover:text-brand-gold transition-colors">Hotels Near Me</SafeLink></li>
                <li><SafeLink href="/become-a-member" className="hover:text-brand-gold transition-colors">Be a Member</SafeLink></li>
              </ul>
            </div>

            <div>
              <h3 className="font-display font-semibold text-lg text-brand-gold mb-4">Support</h3>
              <ul className="space-y-3 text-sm font-bold text-brand-cream/70">
                <li><SafeLink href="/help" className="hover:text-brand-gold transition-colors">Help Center</SafeLink></li>
                <li><SafeLink href="/cancellation" className="hover:text-brand-gold transition-colors">Cancellation Options</SafeLink></li>
                <li><SafeLink href="/contact" className="hover:text-brand-gold transition-colors">Contact Us</SafeLink></li>
              </ul>
            </div>

            <div>
              <h3 className="font-display font-semibold text-lg text-brand-gold mb-4">Policies</h3>
              <ul className="space-y-3 text-sm font-bold text-brand-cream/70">
                <li><SafeLink href="/safety" className="hover:text-brand-gold transition-colors">Safety Information</SafeLink></li>
                <li><SafeLink href="/privacy" className="hover:text-brand-gold transition-colors">Privacy Policy</SafeLink></li>
                <li><SafeLink href="/terms" className="hover:text-brand-gold transition-colors">Terms of Service</SafeLink></li>
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
