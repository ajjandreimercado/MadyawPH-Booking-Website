/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import { lazy, Suspense } from 'react';
import { Routes, Route } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import RootLayout from './components/layout/RootLayout';
import HomePage from './pages/HomePage';
import NotFoundPage from './pages/NotFoundPage';
import AuthCallback from './pages/AuthCallback';

// Lazy-load heavier pages for performance
const SearchResultsPage = lazy(() => import('./pages/SearchResultsPage'));
const HotelDetailPage = lazy(() => import('./pages/HotelDetailPage'));
const BookingPage = lazy(() => import('./pages/BookingPage'));
const BookingConfirmationPage = lazy(() => import('./pages/BookingConfirmationPage'));
const UserDashboardPage = lazy(() => import('./pages/UserDashboardPage'));
const ReviewPage = lazy(() => import('./pages/ReviewPage'));
const TransactionPage = lazy(() => import('./pages/TransactionPage'));
const DestinationsPage = lazy(() => import('./pages/DestinationsPage'));
const ExperiencesPage = lazy(() => import('./pages/ExperiencesPage'));
const ClubPage = lazy(() => import('./pages/ClubPage'));

function PageLoader() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-brand-background">
      <div className="flex flex-col items-center gap-4">
        <Loader2 className="w-10 h-10 text-brand-primary animate-spin" />
        <p className="text-sm font-bold text-brand-dark/60 uppercase tracking-widest">Loading…</p>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <Routes>
      <Route element={<RootLayout />}>
        {/* Core pages */}
        <Route path="/" element={<HomePage />} />
        <Route path="/auth/callback" element={<AuthCallback />} />
        <Route path="*" element={<NotFoundPage />} />

        {/* Search & Discovery */}
        <Route path="/search" element={<Suspense fallback={<PageLoader />}><SearchResultsPage /></Suspense>} />
        <Route path="/destinations" element={<Suspense fallback={<PageLoader />}><DestinationsPage /></Suspense>} />
        <Route path="/experiences" element={<Suspense fallback={<PageLoader />}><ExperiencesPage /></Suspense>} />
        <Route path="/club" element={<Suspense fallback={<PageLoader />}><ClubPage /></Suspense>} />

        {/* Property & Booking flow */}
        <Route path="/hotels/:hotelId" element={<Suspense fallback={<PageLoader />}><HotelDetailPage /></Suspense>} />
        <Route path="/booking/:propertyId" element={<Suspense fallback={<PageLoader />}><BookingPage /></Suspense>} />
        <Route path="/booking/confirm/:bookingId" element={<Suspense fallback={<PageLoader />}><BookingConfirmationPage /></Suspense>} />

        {/* Legacy transaction route — kept for backward compatibility */}
        <Route path="/transaction/:propertyId" element={<Suspense fallback={<PageLoader />}><TransactionPage /></Suspense>} />

        {/* User Dashboard */}
        <Route path="/dashboard" element={<Suspense fallback={<PageLoader />}><UserDashboardPage /></Suspense>} />
        <Route path="/dashboard/:tab" element={<Suspense fallback={<PageLoader />}><UserDashboardPage /></Suspense>} />
        <Route path="/my-bookings" element={<Suspense fallback={<PageLoader />}><UserDashboardPage /></Suspense>} />

        {/* Review */}
        <Route path="/review/new" element={<Suspense fallback={<PageLoader />}><ReviewPage /></Suspense>} />
      </Route>
    </Routes>
  );
}
