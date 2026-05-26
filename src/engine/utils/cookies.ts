/**
 * Cookie read/write helpers used by the cookie-backed `Store`. Mirrors the
 * Klaro-original semantics — `setCookie` always writes `SameSite=Lax`,
 * `deleteCookie` tries multiple Path/Domain combinations to nuke whatever
 * the browser actually has.
 */

export interface CookieEntry {
  name: string;
  value: string;
}

/** Parse `document.cookie` into `[{name, value}, ...]`. Empty in non-DOM contexts. */
export function getCookies(): CookieEntry[] {
  if (typeof document === 'undefined') return [];
  const cookieStrings = document.cookie.split(';');
  const cookies: CookieEntry[] = [];
  const regex = /^\s*([^=]+)\s*=\s*(.*?)$/;
  for (const cookieStr of cookieStrings) {
    const match = regex.exec(cookieStr);
    if (match === null) continue;
    cookies.push({
      name: match[1] ?? '',
      value: match[2] ?? '',
    });
  }
  return cookies;
}

/** Find a single cookie by name, or `null`. */
export function getCookie(name: string): CookieEntry | null {
  for (const cookie of getCookies()) {
    if (cookie.name === name) return cookie;
  }
  return null;
}

/**
 * Set a cookie. `days` controls expiry (omit for session cookie). `domain`
 * and `path` are optional; default path is `/`.
 *
 * Source: https://stackoverflow.com/questions/14573223/set-cookie-and-get-cookie-with-javascript
 */
export function setCookie(
  name: string,
  value: string,
  days?: number,
  domain?: string,
  path?: string
): void {
  if (typeof document === 'undefined') return;
  let suffix = '';
  if (days) {
    const date = new Date();
    date.setTime(date.getTime() + days * 24 * 60 * 60 * 1000);
    suffix = `; expires=${date.toUTCString()}`;
  }
  if (domain !== undefined) {
    suffix += `; domain=${domain}`;
  }
  suffix += path !== undefined ? `; path=${path}` : '; path=/';
  document.cookie = `${name}=${value || ''}${suffix}; SameSite=Lax`;
}

/**
 * Delete a cookie. Tries multiple Path/Domain combinations because browsers
 * scope cookies by both — without trying each variation we leave orphans
 * behind on some setups.
 *
 * Returns `true` if the cookie name is no longer visible to JS after the
 * write attempts, `false` if it's still present (set on a path/domain we
 * can't reach, or re-set by another script between write and read).
 */
export function deleteCookie(name: string, path?: string, domain?: string): boolean {
  if (typeof document === 'undefined') return false;
  let str = `${name}=; Max-Age=-99999999;`;
  // try without path / domain first
  document.cookie = str;
  str += ` path=${path || '/'};`;
  document.cookie = str;
  if (domain !== undefined) {
    str += ` domain=${domain};`;
    document.cookie = str;
  }
  return getCookie(name) === null;
}
