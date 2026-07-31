import { useRef, useState } from 'react';
import { useScroll } from '../../hooks/useScroll';
import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'motion/react';
import { Menu, X } from 'lucide-react';
import { madyawLogoUrl } from '../../lib/branding';
import { useOnClickOutside } from '../../hooks/useOnClickOutside';
import {
  ClubMenu,
  DestinationsMenu,
  ExperiencesMenu,
  type DestinationCategoryKey,
  type ExperienceKey,
} from './NavbarMegaMenus';

type ActiveMenu = 'destinations' | 'experiences' | 'club' | null;

export default function Navbar() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [activeMenu, setActiveMenu] = useState<ActiveMenu>(null);
  const [activeCategory, setActiveCategory] = useState<DestinationCategoryKey>('tropical');
  const [activeExperience, setActiveExperience] = useState<ExperienceKey>('wellness');

  const scrolled = useScroll(20);
  const navRef = useRef<HTMLElement>(null);
  const navigate = useNavigate();

  useOnClickOutside(navRef, () => {
    setActiveMenu(null);
    setMobileMenuOpen(false);
  });

  const handleMobileNav = (path: string) => {
    setMobileMenuOpen(false);
    navigate(path);
  };

  const toggleMenu = (menu: Exclude<ActiveMenu, null>) => {
    setActiveMenu((prev) => (prev === menu ? null : menu));
  };

  const triggerBaseClass =
    'text-[10px] font-bold tracking-widest uppercase transition-colors hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary focus-visible:ring-offset-2 focus-visible:ring-offset-brand-dark';

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
          <span className="text-2xl font-serif font-bold tracking-tight text-brand-cream">Madyaw</span>
        </Link>

        <div className="hidden md:flex items-center gap-10">
          <div
            className="relative py-4"
            onMouseEnter={() => setActiveMenu('destinations')}
            onMouseLeave={() => setActiveMenu((prev) => (prev === 'destinations' ? null : prev))}
          >
            <button
              type="button"
              aria-expanded={activeMenu === 'destinations'}
              onClick={() => toggleMenu('destinations')}
              onFocus={() => setActiveMenu('destinations')}
              className={`${triggerBaseClass} text-brand-cream/80 hover:text-brand-primary`}
            >
              Destinations
            </button>
            <DestinationsMenu
              isOpen={activeMenu === 'destinations'}
              activeCategory={activeCategory}
              onCategoryChange={setActiveCategory}
              onClose={() => setActiveMenu(null)}
            />
          </div>

          <div
            className="relative py-4"
            onMouseEnter={() => setActiveMenu('experiences')}
            onMouseLeave={() => setActiveMenu((prev) => (prev === 'experiences' ? null : prev))}
          >
            <button
              type="button"
              aria-expanded={activeMenu === 'experiences'}
              onClick={() => toggleMenu('experiences')}
              onFocus={() => setActiveMenu('experiences')}
              className={`${triggerBaseClass} text-brand-cream/80 hover:text-brand-primary`}
            >
              Experiences
            </button>
            <ExperiencesMenu
              isOpen={activeMenu === 'experiences'}
              activeExperience={activeExperience}
              onExperienceChange={setActiveExperience}
              onClose={() => setActiveMenu(null)}
            />
          </div>

          <div
            className="relative py-4"
            onMouseEnter={() => setActiveMenu('club')}
            onMouseLeave={() => setActiveMenu((prev) => (prev === 'club' ? null : prev))}
          >
            <button
              type="button"
              aria-expanded={activeMenu === 'club'}
              onClick={() => toggleMenu('club')}
              onFocus={() => setActiveMenu('club')}
              className={`${triggerBaseClass} text-brand-cream/80 hover:text-brand-primary`}
            >
              The Club
            </button>
            <ClubMenu
              isOpen={activeMenu === 'club'}
              currentPoints={4500}
              pointsToElite={10000}
              onClose={() => setActiveMenu(null)}
            />
          </div>
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
            {[
              { label: 'Destinations', path: '/destinations' },
              { label: 'Experiences', path: '/experiences' },
              { label: 'The Club', path: '/club' },
            ].map(({ label, path }) => (
              <button
                key={label}
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
