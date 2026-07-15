/** True when the URL hash is a safe in-page anchor (e.g. #amenities), not OAuth params. */
export function isScrollAnchorHash(hash: string) {
  if (!hash || hash === '#') {
    return false;
  }

  return /^#[A-Za-z][\w-]*$/.test(hash);
}

/** True when the hash looks like an OAuth implicit-flow callback payload. */
export function isOAuthHash(hash: string) {
  const trimmed = hash.startsWith('#') ? hash.slice(1) : hash;
  return trimmed.includes('access_token=') || trimmed.includes('id_token=');
}
