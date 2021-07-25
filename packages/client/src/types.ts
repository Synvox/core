import { AxiosInstance } from "axios";

export type TableConfig<
  Result extends Record<string, any>,
  Params = DeepPartial<Result>,
  InsertType = DeepPartial<Result>,
  UpdateType = DeepPartial<Result>,
  IDColumnName = number
> = {
  row: Result;
  params?: Params;
  insert?: InsertType;
  update?: UpdateType;
  idColumnName?: IDColumnName;
};

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

export type CacheEntry<Key, Result, LoaderOptions> = {
  loadedThroughKey: Key;
  subscribers: Set<SubscriptionCallback>;
  data?: Result;
  promise?: Promise<Result>;
  error?: Error;
  destroyTimeout?: number;
  refreshTimeout?: number;
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

export type Getter<Result, Params extends Record<string, any>, IDColumnName> = {
  (idOrParams?: Params): Collection<Result>;
  (idOrParams: ID<Params, IDColumnName>, params?: Params): Result;
};

export type Handlers<
  Result,
  Params extends Record<string, any>,
  InsertType,
  UpdateType,
  Extension,
  IDColumnName
> = Extension &
  Getter<Result, DeepPartial<Params>, ID<Params, IDColumnName>> & {
    get: Getter<Result, DeepPartial<Params>, ID<Params, IDColumnName>>;
    getUrl: (url: string) => any;
    first: (params?: DeepPartial<Params>) => Result;
    put: (
      idOrQuery: ID<Result, IDColumnName> | DeepPartial<Params>,
      payload: UpdateType,
      params?: DeepPartial<Params>
    ) => Promise<ChangeTo<Result>>;
    post: <R = ChangeTo<Result>>(
      pathOrData: string | InsertType,
      dataOrParams?: InsertType | DeepPartial<Params>,
      params?: DeepPartial<Params>
    ) => Promise<R>;
    delete: (
      id: ID<Result, IDColumnName>,
      params?: DeepPartial<Params>
    ) => Promise<ChangeTo<Result>>;
    count: (params?: DeepPartial<Params>) => number;
    ids: (params?: DeepPartial<Params>) => Collection<ID<Result, IDColumnName>>;
    getAsync: ((
      idOrParams: ID<Params, IDColumnName>,
      params?: Params
    ) => Promise<Result>) &
      ((idOrParams?: Params) => Promise<Collection<Result>>);
    countAsync: (params?: DeepPartial<Params>) => Promise<number>;
    idsAsync: (
      params?: DeepPartial<Params>
    ) => Promise<Collection<ID<Result, IDColumnName>>>;
    rebind(
      getUrl: (url: string) => any
    ): Handlers<
      Result,
      Params,
      InsertType,
      UpdateType,
      Extension,
      IDColumnName
    >;
  };

export type RouteFactory<
  Result,
  Params,
  InsertType,
  UpdateType,
  Extension,
  ID
> = (p: {
  getUrl: (url: string) => any;
  axios: AxiosInstance;
  touch: Touch<string>;
  blockUpdatesById: (id: string) => void;
  lock<T>(fn: () => Promise<T>): Promise<T>;
}) => {
  handlers: Handlers<Result, Params, InsertType, UpdateType, Extension, ID>;
};

export type Touch<Key> = (filter: (key: Key) => boolean) => Promise<void>;
