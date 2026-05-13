/**
 * Storage backends for the ConsentManager.
 *
 * Four implementations of a common `Store` interface:
 *
 *  - `TestStore`     — in-memory only, for unit tests
 *  - `CookieStore`   — `document.cookie` (default)
 *  - `LocalStorageStore`  — `localStorage`
 *  - `SessionStorageStore` — `sessionStorage` (also used as the
 *                           "auxiliary store" for short-lived hints)
 *
 * The `set` / `delete` return values are intentionally `unknown` — Klaro's
 * stores returned whatever the underlying API returned, callers ignore it.
 */

import { deleteCookie, getCookie, setCookie } from './utils/cookies.js';

/** What every store implements. The ConsentManager only reads these three methods. */
export interface Store {
  get(): string | null;
  set(value: string): unknown;
  delete(): unknown;
}

/** Storage stores expose extra get/set/delete-with-key for the auxiliary slot. */
export interface KeyedStore extends Store {
  getWithKey(key: string): string | null;
  setWithKey(key: string, value: string): unknown;
  deleteWithKey(key: string): unknown;
}

/** Subset of the ConsentManager that stores read for configuration. */
export interface StoreManagerLike {
  storageName: string;
  cookieDomain?: string;
  cookiePath?: string;
  cookieExpiresAfterDays?: number;
}

/** In-memory store, used by tests. */
export class TestStore implements Store {
  private value: string | null = null;
  get(): string | null {
    return this.value;
  }
  set(value: string): void {
    this.value = value;
  }
  delete(): void {
    this.value = null;
  }
}

/** `document.cookie`-backed store. The default for SimpleCMP. */
export class CookieStore implements Store {
  private readonly cookieName: string;
  private readonly cookieDomain?: string;
  private readonly cookiePath?: string;
  private readonly cookieExpiresAfterDays?: number;

  constructor(manager: StoreManagerLike) {
    this.cookieName = manager.storageName;
    this.cookieDomain = manager.cookieDomain;
    this.cookiePath = manager.cookiePath;
    this.cookieExpiresAfterDays = manager.cookieExpiresAfterDays;
  }

  get(): string | null {
    const cookie = getCookie(this.cookieName);
    return cookie ? cookie.value : null;
  }

  set(value: string): void {
    setCookie(
      this.cookieName,
      value,
      this.cookieExpiresAfterDays,
      this.cookieDomain,
      this.cookiePath
    );
  }

  delete(): void {
    deleteCookie(this.cookieName);
  }
}

/** Common base class for `localStorage` / `sessionStorage` wrappers. */
abstract class StorageStore implements KeyedStore {
  protected readonly key: string;
  protected readonly handle: Storage;

  constructor(manager: StoreManagerLike, handle: Storage) {
    this.key = manager.storageName;
    this.handle = handle;
  }

  get(): string | null {
    return this.handle.getItem(this.key);
  }
  getWithKey(key: string): string | null {
    return this.handle.getItem(key);
  }
  set(value: string): void {
    this.handle.setItem(this.key, value);
  }
  setWithKey(key: string, value: string): void {
    this.handle.setItem(key, value);
  }
  delete(): void {
    this.handle.removeItem(this.key);
  }
  deleteWithKey(key: string): void {
    this.handle.removeItem(key);
  }
}

export class LocalStorageStore extends StorageStore {
  constructor(manager: StoreManagerLike) {
    super(manager, localStorage);
  }
}

export class SessionStorageStore extends StorageStore {
  constructor(manager: StoreManagerLike) {
    super(manager, sessionStorage);
  }
}

/**
 * Constructor map keyed by `config.storageMethod`. The ConsentManager picks
 * one based on the configured method name (`'cookie'` is the default).
 */
export type StoreConstructor = new (manager: StoreManagerLike) => Store;

const stores: Record<string, StoreConstructor> = {
  cookie: CookieStore,
  test: TestStore,
  localStorage: LocalStorageStore,
  sessionStorage: SessionStorageStore,
};

export default stores;
