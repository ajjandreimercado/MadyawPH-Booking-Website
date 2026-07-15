# Madyaw Security Layer

This project is a client-only SPA with mocked auth and payments. The measures below harden the frontend, but none of them replace server-side enforcement.

## 1. Browser-signed session token
What it does: `AuthContext` generates an HMAC-SHA256 token in the browser and stores it in a ref only.

Protects against: casual token tampering in the client state and accidental persistence in storage.

Limitations: the signing key lives in frontend code, so a determined user can still inspect or recreate it.

Backend replacement: issue signed tokens from the server with a real secret kept off the client, then verify them on protected requests.
Note: This project now issues auth tokens as httpOnly, secure cookies from the API and enforces server-side protections (helmet, rate limiting, stricter JSON limits). Frontend no longer stores JWTs in localStorage.

## 2. Token expiry enforcement
What it does: the shell checks token validity on route changes and every 60 seconds, then logs out expired sessions.

Protects against: stale UI sessions that continue to act authenticated after expiry.

Limitations: it only affects the open tab and does not revoke any real server session.

Backend replacement: enforce expiry on the API and revoke sessions or refresh tokens server-side.

## 3. Input sanitization
What it does: user text is trimmed and HTML-escaped before it enters React state at the hero search and auth inputs.

Protects against: simple XSS payloads entering UI state or query handling.

Limitations: frontend escaping is not a substitute for output encoding and server-side validation.

Backend replacement: validate and encode inputs on the server and escape on output based on the rendering context.

## 4. URL parameter validation
What it does: query params are parsed through a typed validator that rejects invalid types, ratings, and oversized destinations.

Protects against: malformed or malicious query values that could break filter state or UI assumptions.

Limitations: it only protects this SPA and can be bypassed by direct state changes in the browser.

Backend replacement: validate all incoming query params and request filters on the server before using them.

## 5. Safe external links
What it does: `SafeLink` normalizes external anchors, blocks dangerous protocols, and forces `noopener noreferrer`.

Protects against: `javascript:`, `data:`, and `vbscript:` link attacks plus tab-napping.

Limitations: it only covers links rendered through the component and does not secure arbitrary DOM injection.

Backend replacement: continue to sanitize link data on the server and prefer allowlisted destinations in persisted content.

## 6. Content Security Policy
What it does: `index.html` declares a CSP that limits resource loading and blocks objects and foreign connections.

Protects against: broad script and resource injection by reducing what the browser will execute or load.

Limitations: `'unsafe-inline'` remains for current Vite/Tailwind behavior, so the policy is permissive in places.

Backend replacement: move to nonce-based scripts and stricter style handling once a real backend and production pipeline exist.

## 7. Client-side auth rate limiting
What it does: the auth modal tracks failed attempts and applies a 30-second lockout after five bad submissions.

Protects against: casual brute-force retry loops in the UI.

Limitations: this is UI-only and can be bypassed by modifying the page or calling the login flow directly.

Backend replacement: enforce per-account and per-IP throttling, lockouts, and anomaly detection on the authentication endpoint.

## 8. Fixture integrity check
What it does: the property fixture module computes a lightweight checksum and warns if the array changes at runtime.

Protects against: accidental or obvious tampering with fixture data in devtools.

Limitations: it is tamper-evident only and is not cryptographic integrity.

Backend replacement: fetch signed catalog data from the server and verify it with trusted server-side controls.