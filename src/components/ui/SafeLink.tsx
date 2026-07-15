import { useMemo, type AnchorHTMLAttributes } from 'react';

type SafeLinkProps = AnchorHTMLAttributes<HTMLAnchorElement> & {
  allowedProtocols?: string[];
};

const DEFAULT_ALLOWED_PROTOCOLS = ['https:'];
const BLOCKED_PROTOCOLS = new Set(['javascript:', 'data:', 'vbscript:']);

export default function SafeLink({
  href,
  allowedProtocols = DEFAULT_ALLOWED_PROTOCOLS,
  rel: _rel,
  target: _target,
  ...rest
}: SafeLinkProps) {
  const safeHref = useMemo(() => {
    if (!href) {
      return '#';
    }

    try {
      const parsedUrl = new URL(href, window.location.origin);

      if (BLOCKED_PROTOCOLS.has(parsedUrl.protocol) || !allowedProtocols.includes(parsedUrl.protocol)) {
        console.warn('Madyaw: rejected unsafe link —', href);
        return '#';
      }

      return parsedUrl.toString();
    } catch {
      console.warn('Madyaw: rejected unsafe link —', href);
      return '#';
    }
  }, [allowedProtocols, href]);

  return <a {...rest} href={safeHref} rel="noopener noreferrer" target="_blank" />;
}