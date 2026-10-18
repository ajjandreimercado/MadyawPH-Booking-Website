const RETURN_KEY = 'madyaw_auth_return';

/** Persist where to send the guest after Google / email sign-in. */
export function rememberAuthReturn(path: string, options?: { overwrite?: boolean }) {
  if (!path || path.startsWith('/auth/')) return;
  try {
    if (options?.overwrite === false && sessionStorage.getItem(RETURN_KEY)) return;
    // Don't replace a checkout return with a bare home path.
    if (options?.overwrite === false && (path === '/' || path === '')) return;
    sessionStorage.setItem(RETURN_KEY, path);
  } catch {
    // ignore quota / private mode
  }
}

export function takeAuthReturn(fallback = '/'): string {
  try {
    const stored = sessionStorage.getItem(RETURN_KEY);
    if (stored) {
      sessionStorage.removeItem(RETURN_KEY);
      return stored;
    }
  } catch {
    // ignore
  }
  return fallback;
}
