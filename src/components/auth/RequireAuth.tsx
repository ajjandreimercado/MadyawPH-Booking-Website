import { Navigate, useLocation } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { useAuth, type UserRole } from '../../contexts/AuthContext';
import { rememberAuthReturn } from '../../lib/authReturn';
import { useEffect, useRef, useState, type ReactNode } from 'react';

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
  const returnTo = `${location.pathname}${location.search}`;
  const verifiedOnceRef = useRef(false);

  useEffect(() => {
    // A signed-in user (e.g. just completed the modal/Google flow) never needs
    // a re-check — and a stale re-check must not wipe that fresh session.
    if (user) {
      setChecking(false);
      return;
    }
    if (verifiedOnceRef.current) return;
    verifiedOnceRef.current = true;

    let cancelled = false;
    void (async () => {
      await verifyToken();
      if (!cancelled) setChecking(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [user, verifyToken]);

  if (checking) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-brand-background pt-32 pb-16">
        <Loader2 className="w-8 h-8 text-brand-primary animate-spin" />
      </div>
    );
  }

  if (!user) {
    rememberAuthReturn(returnTo);
    return (
      <Navigate
        to="/"
        replace
        state={{ openAuthModal: true, from: returnTo }}
      />
    );
  }

  if (roles && roles.length > 0 && !roles.includes(user.role)) {
    return <Navigate to="/trips" replace />;
  }

  return <>{children}</>;
}
