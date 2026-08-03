import type { AnchorHTMLAttributes, ReactNode } from 'react';
import { Link } from 'react-router-dom';

type SafeLinkProps = AnchorHTMLAttributes<HTMLAnchorElement> & {
  allowedProtocols?: string[];
  children?: ReactNode;
};

const DEFAULT_ALLOWED_PROTOCOLS = ['https:', 'http:'];
const BLOCKED_PROTOCOLS = new Set(['javascript:', 'data:', 'vbscript:']);

function isSameOriginPath(href: string): boolean {
  return href.startsWith('/') && !href.startsWith('//');
}

function resolveHref(href: string | undefined, allowedProtocols: string[]): string {
  if (!href || href === '#') return '#';

  if (isSameOriginPath(href)) return href;

  try {
    const origin = typeof window !== 'undefined' ? window.location.origin : 'https://madyaw.local';
    const parsedUrl = new URL(href, origin);

    if (BLOCKED_PROTOCOLS.has(parsedUrl.protocol) || !allowedProtocols.includes(parsedUrl.protocol)) {
      console.warn('Madyaw: rejected unsafe link —', href);
      return '#';
    }

    if (typeof window !== 'undefined' && parsedUrl.origin === window.location.origin) {
      return parsedUrl.pathname + parsedUrl.search + parsedUrl.hash;
    }

    return parsedUrl.toString();
  } catch {
    console.warn('Madyaw: rejected unsafe link —', href);
    return '#';
  }
}

export default function SafeLink({
  href,
  allowedProtocols = DEFAULT_ALLOWED_PROTOCOLS,
  rel,
  target,
  children,
  className,
  onClick,
  ...rest
}: SafeLinkProps) {
  const safeHref = resolveHref(href, allowedProtocols);

  // Internal app routes — React Router Link (works on http://localhost).
  if (safeHref.startsWith('/') && !safeHref.startsWith('//')) {
    return (
      <Link to={safeHref} className={className} onClick={onClick as never}>
        {children}
      </Link>
    );
  }

  const isExternal = safeHref.startsWith('http');
  return (
    <a
      {...rest}
      className={className}
      onClick={onClick}
      href={safeHref}
      rel={rel ?? (isExternal ? 'noopener noreferrer' : undefined)}
      target={target ?? (isExternal ? '_blank' : undefined)}
    >
      {children}
    </a>
  );
}
