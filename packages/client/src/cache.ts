import { CacheStorage, CacheEntry, Loader } from "./types";
import { SubscriptionCallback } from ".";

type Options = {
  removalTimeout?: number;
  retryCount?: number;
  cacheLife?: number;
  retryDelay?: (attempt: number, err: Error) => number;
};

export default class Cache<Key, LoaderOptions = unknown> {
  private loader: Loader<Key, LoaderOptions>;
  private cacheStorage: CacheStorage<Key>;
  private removalTimeout: number = 1000 * 60 * 3;
  private retryCount: number = 1;
  private cacheLife?: number;
  private retryDelay?: (attempt: number, err: Error) => number;
  constructor(loader: Loader<Key, LoaderOptions>, opts: Options = {}) {
    this.loader = loader;
    this.cacheStorage = new Map();
    this.removalTimeout = opts.removalTimeout ?? 1000 * 60 * 3;
    this.retryCount = opts.retryCount ?? 1;
    this.cacheLife = opts.cacheLife ?? undefined;
    this.retryDelay = opts.retryDelay ?? undefined;
  }

  get<Result>(key: Key, loaderOptions?: LoaderOptions) {
    let cacheEntry = this.cacheStorage.get(key);

    if (!cacheEntry) {
      cacheEntry = {
        loadedThroughKey: key,
        data: undefined,
        promise: undefined,
        error: undefined,
        subscribers: new Set(),
        loaderOptions,
      };

      this.cacheStorage.set(key, cacheEntry);
    }

    return cacheEntry as CacheEntry<Key, Result, LoaderOptions>;
  }

  getUnsafe<Result>(key: Key) {
    let cacheEntry = this.cacheStorage.get(key);

    if (!cacheEntry) {
      throw new Error(`${key} does not exist in cache`);
    }

    return cacheEntry as CacheEntry<Key, Result, LoaderOptions>;
  }

  set<Result>(
    key: Key,
    patch: Partial<CacheEntry<Key, Result, LoaderOptions>>,
    loaderOptions?: LoaderOptions
  ) {
    const cacheEntry = this.get(key, loaderOptions);

    let refreshTimeout: number | undefined = undefined;
    if (this.cacheLife && typeof window !== "undefined") {
      if (cacheEntry.refreshTimeout)
        window.clearTimeout(cacheEntry.refreshTimeout);

      // only schedule reload if this entry was the top level entry
      if (cacheEntry.loadedThroughKey === key) {
        refreshTimeout = window.setTimeout(async () => {
          const commitFn = await this.load(key, 0, loaderOptions);
          commitFn();
        }, this.cacheLife);
      }
    }

    this.cacheStorage.set(key, {
      ...cacheEntry,
      ...patch,
      refreshTimeout,
    });

    return cacheEntry.subscribers;
  }

  async load(
    key: Key,
    attempt = 0,
    loaderOptions?: LoaderOptions
  ): Promise<() => Set<SubscriptionCallback>> {
    const retriesRemaining = this.retryCount - attempt;
    try {
      const promise = this.loader(key, loaderOptions);

      this.set(key, { promise }, loaderOptions);

      const patches = await promise;

      return () => {
        let subscribers = new Set<SubscriptionCallback>();
        for (let [subKey, data] of patches) {
          const subs = this.set(
            subKey,
            {
              loadedThroughKey: key,
              data: data ?? null,
              promise: undefined,
              error: undefined,
            },
            loaderOptions
          );
          subs.forEach((sub) => subscribers.add(sub));
        }
        return subscribers;
      };
    } catch (error) {
      if (retriesRemaining > 0) {
        if (this.retryDelay && typeof window !== "undefined") {
          const waitTime = this.retryDelay(attempt, error);
          await new Promise((r) => window.setTimeout(r, waitTime));
        }

        return this.load(key, attempt + 1, loaderOptions);
      }

      return () =>
        this.set(
          key,
          {
            error,
            promise: undefined,
            data: undefined,
          },
          loaderOptions
        );
    }
  }

  subscribe(key: Key, callback: () => void) {
    if (!this.cacheStorage.has(key)) return;
    let cacheEntry = this.getUnsafe(key);

    if (cacheEntry.subscribers.has(callback)) return;

    if (typeof window !== "undefined")
      window.clearTimeout(cacheEntry.destroyTimeout);

    cacheEntry.subscribers.add(callback);
  }

  unsubscribe(key: Key, callback: () => void) {
    if (!this.cacheStorage.has(key)) return;
    let cacheEntry = this.getUnsafe(key);

    cacheEntry.subscribers.delete(callback);

    if (cacheEntry.subscribers.size === 0) this.scheduleRemoval(key);
  }

  scheduleRemoval(key: Key) {
    if (typeof window !== "undefined") {
      if (!this.cacheStorage.has(key)) return;
      let cacheEntry = this.getUnsafe(key);

      window.clearTimeout(cacheEntry.destroyTimeout);
      cacheEntry.destroyTimeout = window.setTimeout(() => {
        this.delete(key);
      }, this.removalTimeout);
    } else this.delete(key);
  }

  delete(key: Key) {
    if (typeof window !== "undefined") {
      if (!this.cacheStorage.has(key)) return;
      const entry = this.getUnsafe(key);
      window.clearTimeout(entry.destroyTimeout);
      window.clearTimeout(entry.refreshTimeout);
    }

    this.cacheStorage.delete(key);
  }

  async touch(filter: (key: Key) => boolean) {
    const keys = this.cacheStorage.keys();
    const touchedKeys: Set<Key> = new Set();
    for (let key of keys) {
      if (filter(key)) {
        const realKey = this.cacheStorage.get(key)!.loadedThroughKey;
        touchedKeys.add(realKey);
      }
    }

    const promises: Promise<() => Set<SubscriptionCallback>>[] = [];
    for (let key of touchedKeys) {
      if (!this.cacheStorage.has(key)) continue;
      let entry = this.getUnsafe(key);

      if (entry.subscribers.size === 0) {
        if (typeof window !== "undefined") {
          window.clearTimeout(entry.destroyTimeout);
          window.clearTimeout(entry.refreshTimeout);
        }
        this.delete(key);
        continue;
      }

      const promise = this.load(key, 0, entry.loaderOptions as LoaderOptions);
      promises.push(promise);
    }

    const saveFns = await Promise.all(promises);
    const subscriptions: Set<SubscriptionCallback> = new Set();
    saveFns
      .map((saveFn) => saveFn())
      .map((set) => set.forEach((item) => subscriptions.add(item)));

    subscriptions.forEach((fn) => fn());
  }
}
