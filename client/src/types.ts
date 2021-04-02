export type SubscriptionCallback = () => void;

export type CacheEntry<Result> = {
  subscribers: Set<SubscriptionCallback>;
  data?: Result;
  promise?: Promise<Result>;
  error?: Error;
  destroyTimeout?: number;
  refreshTimeout?: number;
};

export type CacheStorage<Key> = Map<Key, CacheEntry<unknown>>;

export type Loader<Key> = (key: Key) => Promise<[Key, unknown][]>;

export type Modifier<Key, In, Out> = (obj: In, get: <T>(key: Key) => T) => Out;
