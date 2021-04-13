import { AxiosInstance } from "axios";

export type SubscriptionCallback = () => void;
export type DataMapValue = { value: unknown };

export type CacheEntry<Key, Result> = {
  loadedThroughKey: Key;
  subscribers: Set<SubscriptionCallback>;
  data?: Result;
  promise?: Promise<Result>;
  error?: Error;
  destroyTimeout?: number;
  refreshTimeout?: number;
};

export type CacheStorage<Key> = Map<Key, CacheEntry<Key, unknown>>;

export type Loader<Key> = (key: Key) => Promise<[Key, unknown][]>;

export type Collection<T> = T[] & {
  hasMore: boolean;
  page?: number;
  limit: number;
  nextPage?: Collection<T>;
  ids: Collection<string>;
  count: number;
};

export type Change = {
  mode: "string";
  path: string;
  row: unknown;
};
export type ChangeTo<T> = {
  data: T;
  changes: Change[];
  update: () => Promise<void>;
};

export type Getter<Result, Params extends Record<string, any>> = ((
  idOrParams: number | string,
  params?: Params
) => Result) &
  ((idOrParams?: Params) => Collection<Result>);

export type Handlers<Result, Params extends Record<string, any>> = Getter<
  Result,
  Params
> & {
  get: Getter<Result, Params>;
  first: (params?: Params) => Result;
  put: (
    id: number | string,
    payload: any,
    params?: Params
  ) => Promise<ChangeTo<Result>>;
  post: (
    pathOrData: string | Record<string, any>,
    dataOrParams?: Record<string, any> | Params,
    params?: Params
  ) => Promise<ChangeTo<Result>>;
  delete: (id: number | string, params?: Params) => Promise<ChangeTo<Result>>;
  count: (params?: Params) => number;
  ids: (params?: Params) => Collection<number | string>;
};

export type RouteFactory<Result, Params> = (p: {
  getUrl: (url: string) => any;
  axios: AxiosInstance;
  touch: Touch<string>;
  blockUpdatesById: (id: string) => void;
  lock<T>(fn: () => Promise<T>): Promise<T>;
}) => {
  handlers: Handlers<Result, Params>;
};

export type Touch<Key> = (filter: (key: Key) => boolean) => Promise<void>;
