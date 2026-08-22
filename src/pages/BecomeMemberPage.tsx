import { Link } from 'react-router-dom';
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
    'inline-flex min-w-[11rem] items-center justify-center rounded-xl border border-brand-primary/15 bg-brand-primary text-brand-cream px-5 py-3 text-left transition-colors hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-55 disabled:hover:bg-brand-primary';

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

export default function BecomeMemberPage() {
  return (
    <div className="min-h-screen bg-brand-background pt-24 pb-16 px-4 sm:px-6 lg:px-8">
      <div className="max-w-3xl mx-auto">
        <section className="bg-brand-cream border border-brand-primary/10 rounded-[2rem] p-8 sm:p-10 shadow-md">
          <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-brand-primary/15 bg-brand-primary/5 px-3 py-1">
            <Sparkles className="h-3.5 w-3.5 text-brand-primary" />
            <p className="text-[10px] font-bold uppercase tracking-widest text-brand-primary">Madyaw Members</p>
          </div>

          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-brand-primary/8 text-brand-primary mb-6">
            <Smartphone className="h-8 w-8" strokeWidth={1.5} />
          </div>

          <h1 className="text-3xl sm:text-4xl font-display font-semibold text-brand-dark">Be a member</h1>
          <p className="mt-4 text-sm sm:text-base text-brand-dark/70 leading-relaxed">
            Download the Madyaw app to join, get your Membership ID, and apply member discounts when you book. Points wallet discount can be used once per day.
          </p>

          <div className="mt-8 flex flex-col sm:flex-row gap-3">
            <StoreButton href={IOS_APP_URL} sublabel="Download on the" label="App Store" />
            <StoreButton href={ANDROID_APP_URL} sublabel="Get it on" label="Google Play" />
          </div>
          {!ANDROID_APP_URL && !IOS_APP_URL && (
            <p className="mt-4 text-xs font-bold text-brand-dark/50">Store links coming soon. Check back to download the app.</p>
          )}

          <div className="mt-10">
            <Link
              to="/"
              className="inline-flex items-center px-7 py-3 border border-brand-primary/25 text-brand-primary text-xs font-bold uppercase tracking-[0.18em] rounded-xl hover:bg-brand-primary hover:text-brand-cream transition-colors"
            >
              Back to Home
            </Link>
          </div>
        </section>
      </div>
    </div>
  );
}
