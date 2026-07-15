import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useState } from 'react';
import { fetchDestinations } from '../../services/api';
import { ChevronRight, Crown, Tag, ArrowUpCircle, Key, Palmtree, Map, Compass, Landmark, Coffee, HeartPulse } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { LucideIcon } from 'lucide-react';

const palawanImage = new URL('../../../palawan.jpg', import.meta.url).href;
const boracayImage = new URL('../../../boracay.jpg', import.meta.url).href;

export type DestinationCategoryKey = 'tropical' | 'alpine';
export type ExperienceKey = 'wellness' | 'culinary' | 'adventure' | 'culture';

interface DestinationsMenuProps {
  isOpen: boolean;
  activeCategory: DestinationCategoryKey;
  onCategoryChange: (category: DestinationCategoryKey) => void;
  onClose: () => void;
}

interface ExperiencesMenuProps {
  isOpen: boolean;
  activeExperience: ExperienceKey;
  onExperienceChange: (experience: ExperienceKey) => void;
  onClose: () => void;
}

interface ClubMenuProps {
  isOpen: boolean;
  currentPoints: number;
  pointsToElite: number;
  onClose: () => void;
}

interface DestinationCard {
  name: string;
  query: string;
  image: string;
}

interface DestinationCategoryContent {
  icon: LucideIcon;
  label: string;
  cards: DestinationCard[];
}

interface ExperienceContent {
  icon: LucideIcon;
  label: string;
  title: string;
  description: string;
  image: string;
  accent: string;
}

const DESTINATION_CONTENT: Record<DestinationCategoryKey, DestinationCategoryContent> = {
  tropical: {
    icon: Palmtree,
    label: 'Tropical',
    cards: [
      { name: 'Palawan, PH', query: 'Palawan, Philippines', image: palawanImage },
      { name: 'Boracay, PH', query: 'Boracay, Philippines', image: boracayImage },
      { name: 'Bali, ID', query: 'Bali', image: 'https://images.unsplash.com/photo-1537953773345-d172ccf13cf1?auto=format&fit=crop&q=80&w=900' },
      { name: 'Maldives', query: 'Maldives', image: 'https://images.unsplash.com/photo-1514282401047-d79a71a590e8?auto=format&fit=crop&q=80&w=900' },
    ],
  },
  alpine: {
    icon: Map,
    label: 'Alpine & Urban',
    cards: [
      { name: 'Santorini, GR', query: 'Santorini, Greece', image: 'https://images.unsplash.com/photo-1570077188670-e3a8d69ac542?auto=format&fit=crop&q=80&w=900' },
      { name: 'Kyoto, JP', query: 'Kyoto, Japan', image: 'https://images.unsplash.com/photo-1493976040322-c1cb5054144e?auto=format&fit=crop&q=80&w=900' },
      { name: 'Swiss Alps', query: 'Swiss Alps', image: 'https://images.unsplash.com/photo-1533250892015-4fa8892f25b2?auto=format&fit=crop&q=80&w=900' },
      { name: 'Tokyo, JP', query: 'Tokyo, Japan', image: 'https://images.unsplash.com/photo-1540959733332-eab4deabeeaf?auto=format&fit=crop&q=80&w=900' },
    ],
  },
};

const EXPERIENCE_CONTENT: Record<ExperienceKey, ExperienceContent> = {
  wellness: {
    icon: HeartPulse,
    label: 'Wellness & Spa',
    title: 'Cliffside Wellness Retreat',
    description: 'Private sunrise yoga, thermal pools, and deep-rest spa rituals framed by ocean views.',
    image: 'https://images.unsplash.com/photo-1545205597-3d9d02c29597?auto=format&fit=crop&q=80&w=1200',
    accent: 'Rebalance body and mind with curated healing experiences.',
  },
  culinary: {
    icon: Coffee,
    label: 'Culinary Journeys',
    title: 'Chef-Led Tasting Table',
    description: 'A private dining journey with local ingredients, wine pairings, and chef storytelling.',
    image: 'https://images.unsplash.com/photo-1559339352-11d035aa65de?auto=format&fit=crop&q=80&w=1200',
    accent: 'Taste the destination through seasonal menus and intimate chef tables.',
  },
  adventure: {
    icon: Compass,
    label: 'Adventure',
    title: 'Mountain Hiking Expedition',
    description: 'Guided trails, summit breakfasts, and panoramic alpine routes built for high-energy explorers.',
    image: 'https://images.unsplash.com/photo-1501555088652-021faa106b9b?auto=format&fit=crop&q=80&w=1200',
    accent: 'Push beyond the resort and into the landscape.',
  },
  culture: {
    icon: Landmark,
    label: 'Culture',
    title: 'Heritage City Atelier Tour',
    description: 'Museum-led walks, architecture tours, and design-forward city experiences with local hosts.',
    image: 'https://images.unsplash.com/photo-1524492449090-1f0c8f5b1b50?auto=format&fit=crop&q=80&w=1200',
    accent: 'Experience the destination through art, history, and craft.',
  },
};

const CLUB_BENEFITS = [
  { icon: Tag, label: 'Exclusive Member Rates' },
  { icon: ArrowUpCircle, label: 'Priority Room Upgrades' },
  { icon: Key, label: 'Private Concierge Access' },
] as const;

function menuTransitionClassName() {
  return 'transition-all duration-200 ease-in-out origin-top';
}

export function DestinationsMenu({ isOpen, activeCategory, onCategoryChange, onClose }: DestinationsMenuProps) {
  const [realDestinations, setRealDestinations] = useState<any[]>([]);

  useEffect(() => {
    fetchDestinations().then(data => {
      setRealDestinations((data as any).featuredDestinations || []);
    }).catch(console.error);
  }, []);

  const categoryContent = DESTINATION_CONTENT[activeCategory];
  const cardsToRender = realDestinations.length > 0 ? realDestinations.slice(0, 4) : categoryContent.cards;

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0, y: 12, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 8, scale: 0.98 }}
          transition={{ duration: 0.2, ease: 'easeInOut' }}
          className={`absolute top-[calc(100%+0px)] left-1/2 -translate-x-1/2 w-[850px] bg-brand-cream text-brand-dark rounded-2xl shadow-md border border-brand-primary/10 p-8 z-50 overflow-hidden cursor-default before:absolute before:-top-4 before:left-0 before:w-full before:h-4 before:bg-transparent ${menuTransitionClassName()}`}
        >
          <div className="grid grid-cols-[1fr_2fr] gap-10">
            <div>
              <h3 className="font-serif font-bold text-2xl mb-5 text-brand-dark">Curated Escapes</h3>
              <div className="space-y-6">
                {Object.entries(DESTINATION_CONTENT).map(([key, content]) => {
                  const categoryKey = key as DestinationCategoryKey;
                  const isActive = activeCategory === categoryKey;
                  const Icon = content.icon;

                  return (
                    <button
                      key={content.label}
                      type="button"
                      onMouseEnter={() => onCategoryChange(categoryKey)}
                      onClick={() => onCategoryChange(categoryKey)}
                      className={`w-full text-left rounded-2xl border p-4 transition-all duration-200 ease-in-out hover:-translate-y-0.5 hover:bg-brand-primary/5 ${
                        isActive ? 'bg-brand-primary/10 border-brand-primary/20 shadow-sm' : 'bg-brand-cream border-transparent'
                      }`}
                    >
                      <h4 className={`flex items-center gap-2 text-[10px] uppercase tracking-widest font-bold mb-3 ${isActive ? 'text-brand-primary' : 'text-brand-dark/60'}`}>
                        <Icon className="w-4 h-4" />
                        {content.label}
                      </h4>
                      <p className="text-xs font-bold text-brand-dark/70 leading-relaxed">
                        {categoryKey === 'tropical'
                          ? 'Island escapes, beach villas, and tropical hideaways.'
                          : 'Snow-capped peaks, cosmopolitan stays, and urban culture.'}
                      </p>
                    </button>
                  );
                })}
              </div>
            </div>

            <AnimatePresence mode="wait">
              <motion.div
                key={activeCategory}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.22, ease: 'easeInOut' }}
              >
                <div className="grid grid-cols-2 gap-4">
                  {cardsToRender.map((dest) => (
                    <Link
                      key={dest.name}
                      to={`/?destination=${encodeURIComponent(dest.query)}`}
                      onClick={onClose}
                      className="group/card relative rounded-xl overflow-hidden aspect-[4/3] cursor-pointer shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary focus-visible:ring-offset-2 focus-visible:ring-offset-brand-cream"
                    >
                      <img src={dest.image} alt={dest.name} className="absolute inset-0 w-full h-full object-cover transition-transform duration-700 group-hover/card:scale-110" onError={e => { (e.target as HTMLImageElement).src = '/hero/slide-1.jpg'; }} />
                      <div className="absolute inset-0 bg-gradient-to-t from-brand-dark/80 to-transparent" />
                      <span className="absolute bottom-4 left-4 text-brand-cream font-bold text-sm tracking-wide">{dest.name}</span>
                    </Link>
                  ))}
                </div>
              </motion.div>
            </AnimatePresence>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function ExperiencesMenu({ isOpen, activeExperience, onExperienceChange }: ExperiencesMenuProps) {
  const featured = EXPERIENCE_CONTENT[activeExperience];

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0, y: 12, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 8, scale: 0.98 }}
          transition={{ duration: 0.2, ease: 'easeInOut' }}
          className={`absolute top-[calc(100%+0px)] left-1/2 -translate-x-1/2 w-[700px] bg-brand-cream text-brand-dark rounded-2xl shadow-md border border-brand-primary/10 p-8 z-50 cursor-default before:absolute before:-top-4 before:w-full before:h-4 before:left-0 before:bg-transparent ${menuTransitionClassName()}`}
        >
          <div className="flex flex-col gap-8">
            <div className="grid grid-cols-4 gap-4">
              {Object.entries(EXPERIENCE_CONTENT).map(([key, experience]) => {
                const experienceKey = key as ExperienceKey;
                const isActive = activeExperience === experienceKey;
                const Icon = experience.icon;

                return (
                  <button
                    key={experience.label}
                    type="button"
                    onClick={() => onExperienceChange(experienceKey)}
                    className={`flex flex-col items-center gap-3 p-4 rounded-xl border transition-all duration-200 ease-in-out cursor-pointer group/icon focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary focus-visible:ring-offset-2 focus-visible:ring-offset-brand-cream ${
                      isActive
                        ? 'bg-brand-primary text-brand-cream border-brand-primary shadow-md'
                        : 'bg-brand-cream border-transparent hover:bg-brand-primary/5 hover:border-brand-primary/10'
                    }`}
                  >
                    <div className={`w-14 h-14 rounded-full flex items-center justify-center transition-colors ${isActive ? 'bg-brand-cream/15 text-brand-cream' : 'bg-brand-primary/10 text-brand-primary group-hover/icon:bg-brand-primary group-hover/icon:text-brand-cream'}`}>
                      <Icon className="w-6 h-6" />
                    </div>
                    <span className="text-xs font-bold font-sans text-center">{experience.label}</span>
                  </button>
                );
              })}
            </div>

            <AnimatePresence mode="wait">
              <motion.div
                key={activeExperience}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.22, ease: 'easeInOut' }}
                className="relative rounded-xl overflow-hidden h-56 group/feat cursor-pointer shadow-md"
              >
                <img src={featured.image} alt={featured.title} className="absolute inset-0 w-full h-full object-cover transition-transform duration-700 group-hover/feat:scale-105" />
                <div className="absolute inset-0 bg-brand-dark/40 group-hover/feat:bg-brand-dark/50 transition-colors" />
                <div className="absolute inset-0 p-6 flex flex-col justify-end">
                  <span className="text-[10px] uppercase font-bold tracking-widest text-brand-primary mb-3 bg-brand-cream px-3 py-1 rounded-full self-start shadow-sm">Featured</span>
                  <h4 className="text-2xl font-serif font-bold text-brand-cream mb-2">{featured.title}</h4>
                  <p className="text-brand-cream/85 text-sm font-medium max-w-xl mb-3">{featured.description}</p>
                  <div className="flex items-center text-brand-cream/80 text-sm font-bold group-hover/feat:text-brand-cream transition-colors opacity-0 translate-y-2 group-hover/feat:opacity-100 group-hover/feat:translate-y-0 duration-300">
                    <span>{featured.accent}</span>
                    <ChevronRight className="w-4 h-4 ml-1" />
                  </div>
                </div>
              </motion.div>
            </AnimatePresence>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function ClubMenu({ isOpen, currentPoints, pointsToElite, onClose }: ClubMenuProps) {
  const progressWidth = Math.min(100, (currentPoints / Math.max(pointsToElite, 1)) * 100);

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0, y: 12, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 8, scale: 0.98 }}
          transition={{ duration: 0.2, ease: 'easeInOut' }}
          className={`absolute top-[calc(100%+0px)] right-0 w-[400px] bg-brand-cream text-brand-dark rounded-2xl shadow-md border border-brand-primary/10 p-8 z-50 cursor-default before:absolute before:-top-4 before:w-full before:h-4 before:left-0 before:bg-transparent ${menuTransitionClassName()}`}
        >
          <div className="flex flex-col gap-6">
            <div className="bg-brand-primary/5 rounded-xl p-6 border border-brand-primary/10">
              <div className="flex justify-between items-start mb-6">
                <div>
                  <p className="text-[10px] uppercase tracking-widest font-bold text-brand-primary/70 mb-1">Current Tier</p>
                  <p className="text-2xl font-serif font-bold text-brand-primary">Madyaw Base</p>
                </div>
                <Crown className="w-8 h-8 text-brand-primary opacity-30 mt-1" />
              </div>
              <div>
                <div className="flex justify-between text-[11px] font-bold mb-2 uppercase tracking-wide">
                  <span className="text-brand-dark">{currentPoints.toLocaleString()} pts</span>
                  <span className="text-brand-primary/70">{pointsToElite.toLocaleString()} pts to Elite</span>
                </div>
                <div className="w-full bg-brand-secondary/20 h-1.5 rounded-full overflow-hidden">
                  <div className="bg-brand-primary h-full rounded-full transition-all duration-300 ease-in-out" style={{ width: `${progressWidth}%` }} />
                </div>
              </div>
            </div>

            <div className="px-1">
              <h4 className="text-[10px] uppercase tracking-widest font-bold text-brand-dark/50 mb-4">Your Premium Benefits</h4>
              <ul className="space-y-4">
                {CLUB_BENEFITS.map((benefit) => {
                  const BenefitIcon = benefit.icon;

                  return (
                    <li
                      key={benefit.label}
                      className="flex items-center gap-4 text-sm font-bold text-brand-dark rounded-xl px-3 py-2 transition-all duration-200 ease-in-out hover:bg-brand-primary/5 hover:translate-x-1"
                    >
                      <div className="w-10 h-10 rounded-full bg-brand-primary/10 flex items-center justify-center text-brand-primary shrink-0">
                        <BenefitIcon className="w-4 h-4" />
                      </div>
                      {benefit.label}
                    </li>
                  );
                })}
              </ul>
            </div>

            <button
              type="button"
              onClick={onClose}
              className="w-full py-4 bg-brand-primary text-brand-cream rounded-xl font-bold tracking-widest uppercase text-[10px] hover:bg-brand-hover hover:shadow-lg transition-all duration-200 ease-in-out shadow-md mt-4 text-center"
            >
              Explore Club Benefits
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}