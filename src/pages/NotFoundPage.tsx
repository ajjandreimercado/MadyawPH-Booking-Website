import { Link } from 'react-router-dom';

export default function NotFoundPage() {
  return (
    <div className="min-h-screen bg-brand-background pt-24 pb-16 px-4 sm:px-6 lg:px-8 flex items-center">
      <div className="max-w-3xl mx-auto w-full bg-brand-cream border border-brand-primary/10 rounded-[2rem] p-10 shadow-md text-center">
        <p className="text-xs font-bold uppercase tracking-[0.22em] text-brand-dark/60">404</p>
        <h1 className="mt-3 text-4xl sm:text-5xl font-serif font-bold text-brand-dark">Page Not Found</h1>
        <p className="mt-4 text-sm sm:text-base font-sans font-medium text-brand-dark/70 max-w-xl mx-auto leading-relaxed">
          The page you are looking for does not exist or may have been moved.
        </p>

        <div className="mt-8 flex justify-center">
          <Link
            to="/"
            className="inline-flex items-center px-8 py-3 bg-brand-primary text-brand-cream text-xs font-bold uppercase tracking-[0.18em] rounded-xl hover:bg-brand-hover transition-colors"
          >
            Back to Home
          </Link>
        </div>
      </div>
    </div>
  );
}
