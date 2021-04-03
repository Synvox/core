import { AxiosInstance } from "axios";

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

export type Collection<T> = T[] & { hasMore: boolean };
export type Change = {
  mode: "string";
  path: string;
  row: unknown;
};
export type ChangeTo<T> = {
  data: T;
  changes: Change[];
  update: ()=>Promise<void>
};

export type Getter<Result, Params extends Record<string, any>> = ((
  idOrParams: number | string,
  params?: Params
) => Result) &
  ((idOrParams?: Params) => Collection<Result>);

export type Route<Result, Params extends Record<string, any>> = Getter<
  Result,
  Params
> & {
  get: Getter<Result, Params>;
  put: (id: number | string, payload: any) => Promise<ChangeTo<Result>>;
  post: (payload: any) => Promise<ChangeTo<Result>>;
  delete: (id: number | string) => Promise<ChangeTo<Result>>;
};

export type RouteFactory<Result, Params> = (p:{
  getUrl: (url: string) => any,
  axios: AxiosInstance,
  handleChanges: (changes: Change[]) => Promise<void>,
  blockUpdatesById: (id: string)=>void;
  lock<T>(fn: () => Promise<T>): Promise<T>
}) => Route<Result, Params>;
