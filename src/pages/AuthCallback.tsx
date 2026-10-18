import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { isAxiosError } from '../services/api';
import { errorMessageFromUnknown } from '../lib/apiError';
import { useToast } from '../components/ui/ToastProvider';
import { useAuth } from '../contexts/AuthContext';
import { takeAuthReturn } from '../lib/authReturn';

function parseHash(hash: string) {
  const trimmed = hash.startsWith('#') ? hash.slice(1) : hash;
  const params = new URLSearchParams(trimmed);
  const id_token = params.get('id_token') ?? params.get('credential');
  return { id_token };
}

function decodeJwtPayload(token: string) {
  try {
    const payload = token.split('.')[1];
    if (!payload) {
      return null;
    }

    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const decoded = decodeURIComponent(
      atob(base64)
        .split('')
        .map((char) => `%${char.charCodeAt(0).toString(16).padStart(2, '0')}`)
        .join(''),
    );
    return JSON.parse(decoded) as { email?: string; name?: string };
  } catch {
    return null;
  }
}

export default function AuthCallback() {
  const navigate = useNavigate();
  const { showToast } = useToast();
  const { loginWithGoogle } = useAuth();

  useEffect(() => {
    (async () => {
      const { id_token } = parseHash(window.location.hash || window.location.search);
      const tokenPayload = id_token ? decodeJwtPayload(id_token) : null;

      if (!id_token) {
        showToast({ title: 'Sign-in incomplete', description: 'Google sign-in did not finish. Please try again.', type: 'error' });
        navigate('/', { replace: true, state: { openAuthModal: true } });
        return;
      }

      try {
        await loginWithGoogle(id_token);
        window.history.replaceState(null, '', window.location.pathname);
        showToast({ title: 'Signed in', description: 'Welcome back!', type: 'success' });
        navigate(takeAuthReturn('/'), { replace: true });
      } catch (error) {
        const message = isAxiosError(error)
          ? (error.response?.data as { message?: string })?.message ?? 'Unable to sign in with Google.'
          : errorMessageFromUnknown(error, 'Unable to sign in with Google.');

        window.history.replaceState(null, '', window.location.pathname);

        if (isAxiosError(error) && error.response?.status === 404) {
          showToast({
            title: 'Create an account',
            description: message,
            type: 'info',
          });

          navigate('/', {
            replace: true,
            state: {
              openAuthModal: true,
              authMode: 'register',
              authEmail: tokenPayload?.email,
              authName: tokenPayload?.name,
            },
          });
          return;
        }

        showToast({ title: 'Sign-in error', description: message, type: 'error' });
        navigate('/', { replace: true, state: { openAuthModal: true } });
      }
    })();
  }, [navigate, showToast, loginWithGoogle]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-brand-background pt-28">
      <p className="text-sm font-bold text-brand-dark/70">Signing in…</p>
    </div>
  );
}
