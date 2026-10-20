import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import AuthModal from '../components/auth/AuthModal';
import { useAuth } from './AuthContext';
import { rememberAuthReturn, takeAuthReturn } from '../lib/authReturn';

type AuthMode = 'login' | 'register';

interface OpenAuthOptions {
  mode?: AuthMode;
  email?: string;
  name?: string;
  /** Full path (+ search) to return to after sign-in */
  returnTo?: string;
}

interface AuthModalContextType {
  openAuthModal: (options?: OpenAuthOptions) => void;
  closeAuthModal: () => void;
}

const AuthModalContext = createContext<AuthModalContextType | undefined>(undefined);

export function AuthModalProvider({ children }: { children: ReactNode }) {
  const location = useLocation();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [isOpen, setIsOpen] = useState(false);
  const [mode, setMode] = useState<AuthMode>('login');
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');

  const closeAuthModal = useCallback(() => setIsOpen(false), []);

  const openAuthModal = useCallback((options?: OpenAuthOptions) => {
    // Already signed in — never show "Sign in to book" again.
    if (user) return;
    if (options?.returnTo) rememberAuthReturn(options.returnTo);
    setMode(options?.mode ?? 'login');
    setEmail(options?.email ?? '');
    setName(options?.name ?? '');
    setIsOpen(true);
  }, [user]);

  // RequireAuth / AuthCallback navigate here with location.state.openAuthModal
  useEffect(() => {
    const state = location.state as {
      openAuthModal?: boolean;
      authMode?: AuthMode;
      authEmail?: string;
      authName?: string;
      from?: string;
    } | null;

    if (!state?.openAuthModal) return;

    // Signed in already (e.g. state replayed after login) — clear it, don't reopen.
    if (user) {
      navigate(`${location.pathname}${location.search}`, { replace: true, state: {} });
      return;
    }

    if (state.from) rememberAuthReturn(state.from);
    setMode(state.authMode ?? 'login');
    setEmail(state.authEmail ?? '');
    setName(state.authName ?? '');
    setIsOpen(true);
    navigate(`${location.pathname}${location.search}`, { replace: true, state: {} });
  }, [location, navigate, user]);

  // Close immediately if a session appears while the modal is open.
  useEffect(() => {
    if (user && isOpen) setIsOpen(false);
  }, [user, isOpen]);

  const handleSuccess = () => {
    setIsOpen(false);
    const returnTo = takeAuthReturn(`${location.pathname}${location.search}`);
    if (returnTo && returnTo !== `${location.pathname}${location.search}`) {
      navigate(returnTo);
    }
  };

  return (
    <AuthModalContext.Provider value={{ openAuthModal, closeAuthModal }}>
      {children}
      <AuthModal
        isOpen={isOpen}
        onClose={closeAuthModal}
        onSuccess={handleSuccess}
        initialMode={mode}
        initialEmail={email}
        initialName={name}
      />
    </AuthModalContext.Provider>
  );
}

export function useAuthModal() {
  const context = useContext(AuthModalContext);
  if (!context) {
    throw new Error('useAuthModal must be used within an AuthModalProvider');
  }
  return context;
}
