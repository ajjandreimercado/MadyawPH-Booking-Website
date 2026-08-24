/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import { lazy, Suspense, useEffect } from 'react';
import { Routes, Route } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import RootLayout from './components/layout/RootLayout';
import HomePage from './pages/HomePage';
import NotFoundPage from './pages/NotFoundPage';

// Lazy-load heavier pages for performance
const SearchResultsPage = lazy(() => import('./pages/SearchResultsPage'));
const HotelDetailPage = lazy(() => import('./pages/HotelDetailPage'));
const BookingPage = lazy(() => import('./pages/BookingPage'));
const BookingConfirmationPage = lazy(() => import('./pages/BookingConfirmationPage'));
const DestinationsPage = lazy(() => import('./pages/DestinationsPage'));
const ExperiencesPage = lazy(() => import('./pages/ExperiencesPage'));
const ClubPage = lazy(() => import('./pages/ClubPage'));
const BecomeMemberPage = lazy(() => import('./pages/BecomeMemberPage'));
const HelpCenterPage = lazy(() => import('./pages/SupportPages').then((m) => ({ default: m.HelpCenterPage })));
const CancellationPage = lazy(() => import('./pages/SupportPages').then((m) => ({ default: m.CancellationPage })));
const SafetyPage = lazy(() => import('./pages/SupportPages').then((m) => ({ default: m.SafetyPage })));
const ContactPage = lazy(() => import('./pages/SupportPages').then((m) => ({ default: m.ContactPage })));
const PrivacyPolicyPage = lazy(() => import('./pages/SupportPages').then((m) => ({ default: m.PrivacyPolicyPage })));
const TermsOfServicePage = lazy(() => import('./pages/SupportPages').then((m) => ({ default: m.TermsOfServicePage })));

function PageLoader() {
  return (
    <div className="flex-grow flex items-center justify-center py-20 bg-brand-background">
      <Loader2 className="w-8 h-8 text-brand-primary animate-spin" />
    </div>
  );
}

/**
 * Guest booking website only.
 * Hotel accept/cancel/email lives in the separate hotel management app (shared MongoDB).
 */
export default function App() {
  useEffect(() => {
    const prefetch = () => {
      void import('./pages/SearchResultsPage');
      void import('./pages/HotelDetailPage');
      void import('./pages/BookingPage');
    };
    const ric = window.requestIdleCallback;
    if (typeof ric === 'function') {
      const id = ric(prefetch, { timeout: 2500 });
      return () => window.cancelIdleCallback(id);
    }
    const t = window.setTimeout(prefetch, 400);
    return () => window.clearTimeout(t);
  }, []);

  return (
    <Routes>
      <Route element={<RootLayout />}>
        <Route path="/" element={<HomePage />} />

        <Route path="/search" element={<Suspense fallback={<PageLoader />}><SearchResultsPage /></Suspense>} />
        <Route path="/destinations" element={<Suspense fallback={<PageLoader />}><DestinationsPage /></Suspense>} />
        <Route path="/experiences" element={<Suspense fallback={<PageLoader />}><ExperiencesPage /></Suspense>} />
        <Route path="/club" element={<Suspense fallback={<PageLoader />}><ClubPage /></Suspense>} />
        <Route path="/become-a-member" element={<Suspense fallback={<PageLoader />}><BecomeMemberPage /></Suspense>} />
        <Route path="/help" element={<Suspense fallback={<PageLoader />}><HelpCenterPage /></Suspense>} />
        <Route path="/cancellation" element={<Suspense fallback={<PageLoader />}><CancellationPage /></Suspense>} />
        <Route path="/safety" element={<Suspense fallback={<PageLoader />}><SafetyPage /></Suspense>} />
        <Route path="/contact" element={<Suspense fallback={<PageLoader />}><ContactPage /></Suspense>} />
        <Route path="/privacy" element={<Suspense fallback={<PageLoader />}><PrivacyPolicyPage /></Suspense>} />
        <Route path="/terms" element={<Suspense fallback={<PageLoader />}><TermsOfServicePage /></Suspense>} />

        <Route path="/hotels/:hotelId" element={<Suspense fallback={<PageLoader />}><HotelDetailPage /></Suspense>} />
        <Route path="/booking/:propertyId" element={<Suspense fallback={<PageLoader />}><BookingPage /></Suspense>} />
        <Route path="/booking/confirm/:bookingId" element={<Suspense fallback={<PageLoader />}><BookingConfirmationPage /></Suspense>} />

        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
