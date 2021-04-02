import { CacheStorage, CacheEntry, Loader } from "./types";
import { SubscriptionCallback } from ".";

type Options = {
  removalTimeout?: number;
  retryCount?: number;
  cacheLife?: number;
  retryDelay?: (attempt: number, err: Error) => number;
};

export default class Cache<Key> {
  private loader: Loader<Key>;
  private cacheStorage: CacheStorage<Key>;
  private removalTimeout: number = 1000 * 60 * 3;
  private retryCount: number = 1;
  private cacheLife?: number;
  private retryDelay?: (attempt: number, err: Error) => number;
  constructor(
    loader: Loader<Key>,
    { removalTimeout, retryCount, cacheLife, retryDelay }: Options = {}
  ) {
    this.loader = loader;
    this.cacheStorage = new Map();
    if (removalTimeout !== undefined) this.removalTimeout = removalTimeout;
    if (retryCount !== undefined) this.retryCount = retryCount;
    if (cacheLife !== undefined) this.cacheLife = cacheLife;
    if (retryDelay !== undefined) this.retryDelay = retryDelay;
  }

  get<Result>(key: Key) {
    let cacheEntry = this.cacheStorage.get(key);

    if (!cacheEntry) {
      cacheEntry = {
        data: undefined,
        promise: undefined,
        error: undefined,
        subscribers: new Set(),
      };

      this.cacheStorage.set(key, cacheEntry);
    }

    return cacheEntry as CacheEntry<Result>;
  }

  set<Result>(key: Key, patch: Partial<CacheEntry<Result>>) {
    const cacheEntry = this.get(key);

    let refreshTimeout: number | undefined = undefined;
    if (this.cacheLife && typeof window !== "undefined") {
      if (cacheEntry.refreshTimeout)
        window.clearTimeout(cacheEntry.refreshTimeout);
      refreshTimeout = window.setTimeout(async () => {
        const commitFn = await this.load(key);
        commitFn();
      }, this.cacheLife);
    }

    this.cacheStorage.set(key, {
      ...cacheEntry,
      ...patch,
      refreshTimeout,
    });

    return cacheEntry.subscribers;
  }

  async load(key: Key, attempt = 0): Promise<() => Set<SubscriptionCallback>> {
    const retriesRemaining = this.retryCount - attempt;
    try {
      const promise = this.loader(key);
      this.set(key, { promise });

      const patches = await promise;

      return () => {
        let subscribers = new Set<SubscriptionCallback>();
        for (let [key, data] of patches) {
          const subs = this.set(key, {
            data: data ?? null,
            promise: undefined,
            error: undefined,
          });
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

        return this.load(key, attempt + 1);
      }

      return () =>
        this.set(key, { error, promise: undefined, data: undefined });
    }
  }

  subscribe(key: Key, callback: () => void) {
    let cacheEntry = this.get(key);

    if (cacheEntry.subscribers.has(callback)) return;

    if (typeof window !== "undefined")
      window.clearTimeout(cacheEntry.destroyTimeout);

    cacheEntry.subscribers.add(callback);
  }

  unsubscribe(key: Key, callback: () => void) {
    const cacheEntry = this.get(key)!;

    cacheEntry.subscribers.delete(callback);

    if (cacheEntry.subscribers.size === 0) this.scheduleRemoval(key);
  }

  scheduleRemoval(key: Key) {
    if (typeof window !== "undefined") {
      const cacheEntry = this.get(key);

      window.clearTimeout(cacheEntry.destroyTimeout);
      cacheEntry.destroyTimeout = window.setTimeout(() => {
        this.delete(key);
      }, this.removalTimeout);
    } else this.delete(key);
  }

  delete(key: Key) {
    if (typeof window !== "undefined") {
      const entry = this.get(key)!;
      window.clearTimeout(entry.destroyTimeout);
      window.clearTimeout(entry.refreshTimeout);
    }

    this.cacheStorage.delete(key);
  }

  async touch(filter: (key: Key) => boolean) {
    const keys = this.cacheStorage.keys();
    const touchedKeys: Key[] = [];
    for (let key of keys) {
      if (filter(key)) {
        touchedKeys.push(key);
      }
    }

    const promises: Promise<() => Set<SubscriptionCallback>>[] = [];
    for (let key of touchedKeys) {
      const entry = this.cacheStorage.get(key)!;

      if (entry.subscribers.size === 0) {
        if (typeof window !== "undefined") {
          window.clearTimeout(entry.destroyTimeout);
          window.clearTimeout(entry.refreshTimeout);
        }
        this.delete(key);
        continue;
      }

      const promise = this.load(key);
      promises.push(promise);
    }

    const commitFns = await Promise.all(promises);

    const subscriberSetArray = commitFns.map((fn) => fn());
    const subscriptions = new Set<SubscriptionCallback>();

    for (let set of subscriberSetArray) {
      for (let fn of set) {
        subscriptions.add(fn);
      }
    }

    for (let sub of subscriptions) {
      sub();
    }
  }
}
