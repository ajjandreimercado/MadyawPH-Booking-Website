import { Navigate, useLocation } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { useAuth, type UserRole } from '../../contexts/AuthContext';
import { useEffect, useState, type ReactNode } from 'react';

interface RequireAuthProps {
  children: ReactNode;
  roles?: UserRole[];
}

/**
 * Gates a route behind an authenticated session.
 * Optionally requires one of the listed roles (e.g. admin/staff).
 */
export default function RequireAuth({ children, roles }: RequireAuthProps) {
  const { user, verifyToken } = useAuth();
  const location = useLocation();
  const [checking, setChecking] = useState(!user);

  useEffect(() => {
    let cancelled = false;

    if (user) {
      setChecking(false);
      return;
    }

    void (async () => {
      await verifyToken();
      if (!cancelled) setChecking(false);
    })();

    return () => {
      cancelled = true;
    };
    // Intentionally run once on mount when session is unknown.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (checking) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-brand-background pt-32 pb-16">
        <Loader2 className="w-8 h-8 text-brand-primary animate-spin" />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/" replace state={{ openAuthModal: true, from: location.pathname }} />;
  }

  if (roles && roles.length > 0 && !roles.includes(user.role)) {
    return <Navigate to="/dashboard/bookings" replace />;
  }

  return <>{children}</>;
}
