import { Link } from 'react-router-dom';

export default function ClubPage() {
  return (
    <div className="min-h-screen bg-brand-background pt-24 pb-16 px-4 sm:px-6 lg:px-8">
      <div className="max-w-6xl mx-auto">
        <section className="bg-brand-cream border border-brand-primary/10 rounded-[2rem] p-8 sm:p-10 shadow-md">
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-brand-dark/60">Club</p>
          <h1 className="mt-3 text-3xl sm:text-4xl font-serif font-bold text-brand-dark">Madyaw Club</h1>
          <p className="mt-4 text-sm sm:text-base text-brand-dark/70 leading-relaxed max-w-3xl">
            Join our club for priority booking access, premium perks, and personalized hotel recommendations.
          </p>
          <div className="mt-8">
            <Link
              to="/"
              className="inline-flex items-center px-7 py-3 bg-brand-primary text-brand-cream text-xs font-bold uppercase tracking-[0.18em] rounded-xl hover:bg-brand-hover transition-colors"
            >
              View Hotels
            </Link>
          </div>
        </section>
      </div>
    </div>
  );
}
