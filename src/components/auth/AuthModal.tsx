import { useEffect, useRef, useState, type ChangeEvent, type FormEvent, type ReactNode } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Mail, Lock, ArrowRight, X } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../ui/ToastProvider';
import { sanitize } from '../../utils/sanitize';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
  initialMode?: AuthMode;
  initialEmail?: string;
  initialName?: string;
}

type AuthMode = 'login' | 'register';

export default function AuthModal({
  isOpen,
  onClose,
  onSuccess,
  initialMode = 'login',
  initialEmail = '',
  initialName = '',
}: AuthModalProps) {
  const { login, register } = useAuth();
  const { showToast } = useToast();
  
  const [authMode, setAuthMode] = useState<AuthMode>(initialMode);
  const [fullName, setFullName] = useState(initialName);
  const [guestEmail, setGuestEmail] = useState(initialEmail);
  const [guestPassword, setGuestPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [googleError, setGoogleError] = useState('');
  const [lockoutRemaining, setLockoutRemaining] = useState(0);
  
  const failedAttemptsRef = useRef<number>(0);
  const lockoutExpiryRef = useRef<number>(0);
  const [errorMessage, setErrorMessage] = useState('');

  const isLockedOut = lockoutRemaining > 0;

  const resetLockout = () => {
    failedAttemptsRef.current = 0;
    lockoutExpiryRef.current = 0;
    setLockoutRemaining(0);
  };

  useEffect(() => {
    if (!isLockedOut) return undefined;
    const intervalId = window.setInterval(() => {
      const remainingSeconds = Math.ceil((lockoutExpiryRef.current - Date.now()) / 1000);
      if (remainingSeconds <= 0) {
        resetLockout();
        return;
      }
      setLockoutRemaining(remainingSeconds);
    }, 1000);
    return () => window.clearInterval(intervalId);
  }, [isLockedOut]);

  const handleClose = () => {
    setIsLoading(false);
    setErrorMessage('');
    setGoogleError('');
    setAuthMode('login');
    setFullName('');
    setGuestEmail('');
    setGuestPassword('');
    onClose();
  };

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    setAuthMode(initialMode);
    setFullName(initialName);
    setGuestEmail(initialEmail);
    setGuestPassword('');
    setErrorMessage('');
    setGoogleError('');
  }, [isOpen, initialMode, initialEmail, initialName]);

  const handleGoogleRedirect = () => {
    const googleClientId = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env?.VITE_GOOGLE_CLIENT_ID;
    const configuredRedirectUri = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env?.VITE_GOOGLE_REDIRECT_URI;
    const redirectUri = configuredRedirectUri?.trim() || `${window.location.origin}/auth/callback`;

    if (!googleClientId) {
      setGoogleError('Google sign-in is not configured.');
      return;
    }

    // OWASP A07: random nonce per request — prevents replay attacks.
    // A static nonce ("nonce123") lets any stolen token be reused indefinitely.
    const nonceBytes = new Uint8Array(16);
    crypto.getRandomValues(nonceBytes);
    const nonce = Array.from(nonceBytes, (b) => b.toString(16).padStart(2, '0')).join('');

    const params = new URLSearchParams({
      client_id: googleClientId,
      redirect_uri: redirectUri,
      response_type: 'token id_token',
      scope: 'email profile',
      nonce,
    });
    window.location.href = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  };

  const handleGuestLogin = async (e: FormEvent) => {
    e.preventDefault();
    if (isLockedOut) return;

    const emailValue = sanitize(guestEmail);
    const passwordValue = guestPassword;
    const hasValidCredentials = emailValue.length > 0 && emailValue.includes('@') && passwordValue.length >= 6;

    if (!hasValidCredentials) {
      failedAttemptsRef.current += 1;
      setErrorMessage('Please enter a valid email address and password.');
      if (failedAttemptsRef.current >= 5) {
        lockoutExpiryRef.current = Date.now() + 30_000;
        setLockoutRemaining(30);
      }
      return;
    }

    setErrorMessage('');
    setIsLoading(true);

    try {
      await login({ email: emailValue || 'guest@example.com', password: passwordValue });
      failedAttemptsRef.current = 0;
      resetLockout();
      showToast({ title: 'Successfully logged in!', description: 'Welcome to Madyaw.', type: 'success' });
      onClose();
      onSuccess?.();
    } catch (error) {
      failedAttemptsRef.current += 1;
      setErrorMessage(error instanceof Error ? error.message : 'Unable to sign in.');
      if (failedAttemptsRef.current >= 5) {
        lockoutExpiryRef.current = Date.now() + 30_000;
        setLockoutRemaining(30);
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleRegister = async (e: FormEvent) => {
    e.preventDefault();
    if (isLockedOut) return;

    const nameValue = sanitize(fullName);
    const emailValue = sanitize(guestEmail);
    const passwordValue = guestPassword;
    const hasValidCredentials = nameValue.length >= 2 && emailValue.length > 0 && emailValue.includes('@') && passwordValue.length >= 6;

    if (!hasValidCredentials) {
      failedAttemptsRef.current += 1;
      setErrorMessage('Please enter your name, a valid email address, and a password of at least 6 characters.');
      if (failedAttemptsRef.current >= 5) {
        lockoutExpiryRef.current = Date.now() + 30_000;
        setLockoutRemaining(30);
      }
      return;
    }

    setErrorMessage('');
    setIsLoading(true);

    try {
      await register({ name: nameValue, email: emailValue, password: passwordValue });
      failedAttemptsRef.current = 0;
      resetLockout();
      showToast({ title: 'Account created', description: 'Welcome to Madyaw.', type: 'success' });
      onClose();
      onSuccess?.();
    } catch (error) {
      failedAttemptsRef.current += 1;
      setErrorMessage(error instanceof Error ? error.message : 'Unable to create account.');
      if (failedAttemptsRef.current >= 5) {
        lockoutExpiryRef.current = Date.now() + 30_000;
        setLockoutRemaining(30);
      }
    } finally {
      setIsLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6 overflow-hidden">
        {/* Backdrop */}
        <motion.div 
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={handleClose}
          className="absolute inset-0 bg-brand-dark/40 backdrop-blur-sm"
        />

        <motion.div 
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 20 }}
          transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
          className="w-full max-w-[480px] bg-brand-cream rounded-[2rem] shadow-xl overflow-y-auto max-h-[90vh] relative z-10 border border-brand-primary/10"
        >
          <button 
            type="button"
            onClick={handleClose}
            aria-label="Close authentication modal"
            className="absolute top-4 right-4 z-20 p-2 bg-brand-primary/5 hover:bg-brand-primary/10 rounded-full transition-colors active:scale-95 text-brand-dark hover:text-brand-primary"
          >
            <X className="w-5 h-5 stroke-[2.5]" />
          </button>

          <div className="p-8 md:p-10 relative">
            <div className="text-center mb-8">
              <h2 className="text-3xl font-serif font-bold text-brand-dark mb-3">{authMode === 'login' ? 'Welcome Back' : 'Create Account'}</h2>
              <p className="text-brand-dark font-sans font-bold text-sm">
                {authMode === 'login' ? 'Please sign in to continue your journey.' : 'Create your account to start booking.'}
              </p>
            </div>

            <motion.form
              onSubmit={authMode === 'login' ? handleGuestLogin : handleRegister}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.25 }}
              className="space-y-5"
            >
              {authMode === 'register' ? (
                <InputField
                  icon={<UserIcon className="w-5 h-5" />}
                  label="Full Name"
                  type="text"
                  placeholder="Your name"
                  value={fullName}
                  onChange={(e) => {
                    setFullName(sanitize(e.target.value));
                  }}
                  disabled={isLockedOut}
                />
              ) : null}
              <InputField 
                icon={<Mail className="w-5 h-5" />} 
                label="Email Address" 
                type="email" 
                placeholder="you@example.com"
                value={guestEmail}
                onChange={(e) => {
                  setGuestEmail(sanitize(e.target.value));
                }}
                disabled={isLockedOut}
              />
              <InputField
                icon={<Lock className="w-5 h-5" />}
                label="Password"
                type="password"
                placeholder="••••••••"
                value={guestPassword}
                onChange={(e) => {
                  setGuestPassword(e.target.value);
                }}
                disabled={isLockedOut}
              />

              {isLockedOut ? (
                <p className="text-xs font-bold text-red-600">Too many attempts. Try again in {lockoutRemaining}s.</p>
              ) : errorMessage ? (
                <p className="text-xs font-bold text-red-600">{errorMessage}</p>
              ) : null}
              
              <div className="flex justify-between items-center py-2">
                <label className="flex items-center gap-2 cursor-pointer group">
                  <div className="relative flex items-center justify-center w-4 h-4 rounded-[3px] border border-brand-primary/20 bg-brand-cream group-hover:border-brand-primary transition-colors">
                    <input type="checkbox" className="peer sr-only" />
                    <div className="w-2.5 h-2.5 rounded-sm bg-brand-primary scale-0 peer-checked:scale-100 transition-transform origin-center" />
                  </div>
                  <span className="text-xs font-bold text-brand-dark/70">Remember me</span>
                </label>
                <Link to="#" className="text-xs font-bold hover:text-brand-primary transition-colors text-brand-dark">
                  Forgot Password?
                </Link>
              </div>

              <button 
                type="submit"
                disabled={isLoading || isLockedOut}
                className="w-full py-4 bg-brand-primary text-brand-cream rounded-xl text-xs tracking-widest uppercase font-bold flex justify-center items-center gap-2 hover:bg-brand-hover transition-colors duration-300 mt-6 shadow-md shadow-brand-primary/20 active:scale-95 focus:ring-4 focus:ring-brand-primary/20 outline-none"
              >
                <span>{authMode === 'login' ? 'Sign In to Book' : 'Create Account'}</span>
                <ArrowRight className="w-4 h-4" />
              </button>

              <div className="text-center pt-4">
                {authMode === 'login' ? (
                  <>
                    <span className="text-xs font-bold text-brand-dark">New to Madyaw? </span>
                    <button type="button" onClick={() => setAuthMode('register')} className="text-xs font-bold text-brand-primary hover:underline">
                      Create an account
                    </button>
                  </>
                ) : (
                  <>
                    <span className="text-xs font-bold text-brand-dark">Already have an account? </span>
                    <button type="button" onClick={() => setAuthMode('login')} className="text-xs font-bold text-brand-primary hover:underline">
                      Sign in
                    </button>
                  </>
                )}
              </div>
            </motion.form>

            <div className="pt-8 mt-8 border-t border-brand-primary/10">
              <div className="text-center mb-6 relative">
                <span className="absolute inset-0 top-1/2 -translate-y-1/2 flex items-center" aria-hidden="true">
                  <div className="w-full border-t border-brand-primary/10" />
                </span>
                <div className="relative flex justify-center">
                  <span className="bg-brand-cream px-4 text-[10px] tracking-widest font-bold text-brand-dark uppercase">Or continue with</span>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 items-stretch">
                <button
                  type="button"
                  onClick={handleGoogleRedirect}
                  className="flex justify-center items-center gap-3 py-3 px-4 rounded-xl border border-brand-primary/10 hover:bg-brand-primary/5 transition-colors active:scale-95"
                >
                  <svg className="w-5 h-5" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                  </svg>
                  <span className="text-xs font-bold text-brand-dark">Continue with Google</span>
                </button>
              </div>

              {googleError ? <p className="text-xs font-bold text-red-600 text-center mt-3">{googleError}</p> : null}
            </div>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}

// Reusable Input Component
function InputField({ icon, label, type, placeholder, value, onChange, disabled = false }: { icon: ReactNode, label: string, type: string, placeholder: string, value?: string, onChange?: (e: ChangeEvent<HTMLInputElement>) => void, disabled?: boolean }) {
  const inputId = label.toLowerCase().replace(/[^a-z0-9]+/g, '-');

  return (
    <div className="relative group">
      <div className="absolute left-4 top-1/2 -translate-y-1/2 text-brand-primary group-focus-within:text-brand-primary transition-colors">
        {icon}
      </div>
      <div className="h-full flex flex-col justify-center px-12 py-3 bg-brand-cream rounded-xl hover:bg-brand-primary/5 focus-within:bg-brand-cream transition-all cursor-text border border-brand-primary/10 focus-within:border-brand-primary shadow-sm">
        <label htmlFor={inputId} className="text-[10px] font-bold text-brand-dark uppercase tracking-widest mb-0.5">{label}</label>
        <input 
          id={inputId}
          type={type} 
          placeholder={placeholder}
          value={value}
          onChange={onChange}
          disabled={disabled}
          className="bg-transparent border-none outline-none text-brand-dark placeholder-brand-dark/50 text-sm font-bold w-full"
        />
      </div>
    </div>
  );
}

function UserIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 21a8 8 0 0 0-16 0" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}
