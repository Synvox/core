import { AxiosInstance, AxiosPromise } from "axios";

export type TableConfig<Item, Row extends Record<string, any>> = {
  item: Item;
  row: Row;
};

export type IDColumnType<T, IDColumnName> = IDColumnName extends keyof T
  ? T[IDColumnName]
  : unknown;

export type NotArray<T> = T extends unknown[] ? never : T;

export type SubscriptionCallback = () => void;

export type CacheEntry<Key, Result, LoaderOptions> = {
  loadedThroughKey: Key;
  subscribers: Set<SubscriptionCallback>;
  data?: Result;
  promise?: Promise<Result>;
  error?: Error;
  destroyTimeout?: number;
  loaderOptions: LoaderOptions;
};

export type CacheStorage<Key> = Map<Key, CacheEntry<Key, unknown, unknown>>;

export type Loader<Key, Options = unknown> = (
  key: Key,
  options?: Options
) => Promise<[Key, unknown][]>;

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
  views?: string[];
};

export type ChangeTo<T> = {
  result: T;
  changes: Change[];
  update: () => Promise<void>;
};

export type Params = Record<string, any>;
export type ID = string | number;
export type Getter<Result> = {
  (idOrParams?: Params): Collection<Result>;
  (idOrParams: ID, params?: Params): Result;
};

export type Handlers<Item, Row, Extension> = Extension &
  Getter<Item> & {
    get: Getter<Item>;
    getUrl: (url: string) => any;
    first: (params?: Params) => Item;
    put: (
      idOrQuery: ID | Params,
      payload: any,
      params?: Params
    ) => Promise<ChangeTo<Row>>;
    post: <R = ChangeTo<Row>>(
      pathOrData: string | any,
      dataOrParams?: any | Params,
      params?: Params
    ) => Promise<R>;
    delete: (id: ID, params?: Params) => Promise<ChangeTo<Row>>;
    count: (params?: Params) => number;
    ids: <I = ID>(params?: Params) => Collection<I>;
    async: {
      get: ((idOrParams: ID, params?: Params) => Promise<Row>) &
        ((idOrParams?: Params) => AxiosPromise);
      first: (params?: Params) => AxiosPromise;
      count: (params?: Params) => AxiosPromise;
      ids: (params?: Params) => AxiosPromise;
    };
    rebind(getUrl: (url: string) => any): Handlers<Item, Row, Extension>;
  };

export type RouteFactory<Item, Row, Extension> = (p: {
  getUrl: (url: string) => any;
  axios: AxiosInstance;
  touch: Touch<string>;
  blockUpdatesById: (id: string) => void;
  lock<T>(fn: () => Promise<T>): Promise<T>;
}) => {
  handlers: Handlers<Item, Row, Extension>;
};

export type Touch<Key> = (filter: (key: Key) => boolean) => Promise<void>;

export type Entry<T> = {
  data?: T;
  promise?: Promise<void>;
  error?: Error;
  subscribers: Set<Subscriber>;
  refreshTimeout?: ReturnType<typeof setTimeout>;
  loadedThrough: string;
};

export type Subscriber = (number: number) => void;
