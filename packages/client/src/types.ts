import { AxiosInstance } from "axios";

type DeepPartial<T> = {
  [P in keyof T]?: DeepPartial<T[P]>;
};

export type IDColumnType<T, IDColumnName> = IDColumnName extends keyof T
  ? T[IDColumnName]
  : unknown;

export type NotArray<T> = T extends unknown[] ? never : T;

export type ID<T, IDColumnName = "id"> = NotArray<
  IDColumnType<T, IDColumnName>
>;

export type SubscriptionCallback = () => void;

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
  result: T;
  changes: Change[];
  update: () => Promise<void>;
};

export type Getter<
  Result,
  Params extends Record<string, any>,
  IDColumnName
> = ((idOrParams: ID<Params, IDColumnName>, params?: Params) => Result) &
  ((idOrParams?: Params) => Collection<Result>);

export type Handlers<
  Result,
  Params extends Record<string, any>,
  IDColumnName
> = Getter<Result, DeepPartial<Params>, IDColumnName> & {
  get: Getter<Result, DeepPartial<Params>, ID<Params, IDColumnName>>;
  first: (params?: DeepPartial<Params>) => Result;
  put: (
    idOrQuery: ID<Result, IDColumnName> | DeepPartial<Params>,
    payload: any,
    params?: DeepPartial<Params>
  ) => Promise<ChangeTo<Result>>;
  post: (
    pathOrData: string | Record<string, any>,
    dataOrParams?: any | DeepPartial<Params>,
    params?: DeepPartial<Params>
  ) => Promise<ChangeTo<Result>>;
  delete: (
    id: ID<Result, IDColumnName>,
    params?: DeepPartial<Params>
  ) => Promise<ChangeTo<Result>>;
  count: (params?: DeepPartial<Params>) => number;
  ids: (params?: DeepPartial<Params>) => Collection<ID<Result, IDColumnName>>;
};

export type RouteFactory<Result, Params, ID> = (p: {
  getUrl: (url: string) => any;
  axios: AxiosInstance;
  touch: Touch<string>;
  blockUpdatesById: (id: string) => void;
  lock<T>(fn: () => Promise<T>): Promise<T>;
}) => {
  handlers: Handlers<Result, Params, ID>;
};

export type Touch<Key> = (filter: (key: Key) => boolean) => Promise<void>;
