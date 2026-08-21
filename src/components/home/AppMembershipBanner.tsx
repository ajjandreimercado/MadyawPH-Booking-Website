import { Smartphone, Sparkles } from 'lucide-react';

const ANDROID_APP_URL = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env?.VITE_ANDROID_APP_URL ?? '';
const IOS_APP_URL = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env?.VITE_IOS_APP_URL ?? '';

function StoreButton({
  href,
  label,
  sublabel,
}: {
  href: string;
  label: string;
  sublabel: string;
}) {
  const className =
    'inline-flex min-w-[10.5rem] items-center justify-center rounded-xl border border-white/15 bg-white/10 px-4 py-3 text-left text-brand-cream backdrop-blur-sm transition-colors hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-60';

  const inner = (
    <span>
      <span className="block text-[10px] font-bold uppercase tracking-widest text-brand-cream/70">{sublabel}</span>
      <span className="block text-sm font-bold">{label}</span>
    </span>
  );

  if (!href) {
    return (
      <button type="button" disabled className={className} title="App store link coming soon">
        {inner}
      </button>
    );
  }

  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={className}>
      {inner}
    </a>
  );
}

export default function AppMembershipBanner() {
  return (
    <section className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-brand-dark via-brand-primary to-brand-hover p-8 md:p-12">
      <div className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-brand-secondary/20 blur-3xl" />
      <div className="relative z-10 flex flex-col items-center gap-8 md:flex-row md:items-center md:justify-between">
        <div className="max-w-xl text-center md:text-left">
          <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1">
            <Sparkles className="h-3.5 w-3.5 text-brand-secondary" />
            <p className="text-[10px] font-bold uppercase tracking-widest text-brand-cream/80">Madyaw Members</p>
          </div>
          <h2 className="mb-3 font-serif text-3xl font-bold leading-tight text-brand-cream md:text-4xl">
            Install the app. Become a member. Get discounts.
          </h2>
          <p className="text-sm font-medium leading-relaxed text-brand-cream/75">
            Join Madyaw in the app to get your Membership ID, then enter it at checkout for member rates from your points wallet — once per day.
          </p>
        </div>

        <div className="flex shrink-0 flex-col items-center gap-4">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-white/15 bg-white/10 text-brand-cream">
            <Smartphone className="h-8 w-8" strokeWidth={1.5} />
          </div>
          <div className="flex flex-col gap-3 sm:flex-row">
            <StoreButton href={IOS_APP_URL} sublabel="Download on the" label="App Store" />
            <StoreButton href={ANDROID_APP_URL} sublabel="Get it on" label="Google Play" />
          </div>
          {!ANDROID_APP_URL && !IOS_APP_URL && (
            <p className="text-center text-[11px] font-bold text-brand-cream/55">Store links coming soon</p>
          )}
        </div>
      </div>
    </section>
  );
}
