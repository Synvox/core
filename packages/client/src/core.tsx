import qs from "qs";
import {
  Collection,
  Change,
  ChangeTo,
  Handlers,
  ID,
  TableConfig,
  Params,
} from "./types";
import { CoreCache } from "./CoreCache";
import { createContext, ReactNode, useContext } from "react";

function qsStringify(val: any) {
  return qs.stringify(val, {
    encodeValuesOnly: true,
    arrayFormat: "brackets",
  });
}

type Options = {
  shouldTouch?: (change: Change, url: string) => boolean;
};

class Table<Item, Row, Extension> {
  path: string;

  blockUpdatesById: (id: string) => void;
  lock: <T>(fn: () => Promise<T>) => Promise<T>;
  shouldTouch: (change: Change, url: string) => boolean;
  constructor(path: string, options: Options = {}) {
    this.path = path;

    this.blockUpdatesById = () => {};
    this.lock = async (x) => x();
    this.shouldTouch =
      options.shouldTouch ??
      ((change: Change, url: string) => {
        return (
          url.includes(change.path) ||
          (change.views !== undefined &&
            change.views.some((path) => path === this.path))
        );
      });
  }

  handlersFor({
    getUrl,
    cache,
    handleChanges,
  }: {
    getUrl: (url: string) => any;
    cache: CoreCache;
    handleChanges: (changes: Change[]) => Promise<void>;
  }): Handlers<Item, Row, Extension> {
    const { axios } = cache;
    const { path, lock, blockUpdatesById } = this;

    function get(idOrParams?: ID | Params, params?: Params) {
      if (typeof idOrParams === "object") {
        return getUrl(`${path}?${qsStringify(idOrParams)}`) as Item;
      } else {
        let fullPath = path;

        if (idOrParams) fullPath += `/${idOrParams}`;

        if (params && Object.keys(params).length > 0) {
          fullPath += `?${qsStringify(params)}`;
        }

        return getUrl(fullPath) as Collection<Item>;
      }
    }

    //@ts-expect-error
    return Object.assign(
      (idOrParams?: ID | Params, params?: Params) => get(idOrParams, params),
      {
        get: get,
        getUrl: getUrl,
        first(params?: Params) {
          let fullPath = `${path}/first`;
          if (params) {
            fullPath += `?${qsStringify(params)}`;
          }

          return getUrl(fullPath) as Item;
        },
        async put(
          idOrQuery: ID | Params,
          data: Record<string, any>,
          params?: Params
        ) {
          let fullPath = path;
          if (typeof idOrQuery === "object")
            params = { ...params, ...(idOrQuery as Params) };
          else fullPath += `/${idOrQuery}`;

          if (params && Object.keys(params).length > 0)
            fullPath += `?${qsStringify(params)}`;

          return await lock!(async () => {
            const { data: result } = await axios.put(fullPath, data);
            if (result.changeId) blockUpdatesById(result.changeId);
            result.update = () => handleChanges(result.changes);
            return result as ChangeTo<Row>;
          });
        },
        async post<ReturnValue = ChangeTo<Row>>(
          pathOrData: string | Record<string, any>,
          dataOrParams?: Record<string, any> | Params,
          params?: Params
        ) {
          let data = dataOrParams as Record<string, any>;
          let realParams: Params | undefined = params;

          let fullPath = path;
          if (typeof pathOrData === "string") {
            fullPath += pathOrData;
          } else {
            data = pathOrData;
            realParams = dataOrParams as Params;
          }

          if (realParams && Object.keys(realParams).length > 0)
            fullPath += `?${qsStringify(realParams)}`;

          return await lock(async () => {
            const { data: result } = await axios.post(fullPath, data, {
              params: undefined,
            });
            if (!result.changeId) return result;

            blockUpdatesById(result.changeId);
            result.update = () => handleChanges(result.changes);
            return result as ReturnValue;
          });
        },
        async delete(id: ID, params?: Params) {
          let fullPath = `${path}/${id}`;
          if (params && Object.keys(params).length > 0) {
            fullPath += `?${qsStringify(params)}`;
          }
          return await lock(async () => {
            const { data: result } = await axios.delete(fullPath, {
              params: undefined,
            });
            if (result.changeId) blockUpdatesById(result.changeId);
            result.update = () => handleChanges(result.changes);
            return result as ChangeTo<Row>;
          });
        },
        count(params?: Params) {
          let fullPath = `${path}/count`;
          if (params && Object.keys(params).length > 0) {
            fullPath += `?${qsStringify(params)}`;
          }
          return getUrl(fullPath) as number;
        },
        ids(params?: Params) {
          let fullPath = `${path}/ids`;
          if (params && Object.keys(params).length > 0) {
            fullPath += `?${qsStringify(params)}`;
          }
          return getUrl(fullPath) as Collection<ID>;
        },
        async: {
          async get(idOrParams?: ID | Params, params?: Params) {
            let fullPath = path;

            if (idOrParams && typeof idOrParams !== "object")
              fullPath += `/${idOrParams}`;
            else params = idOrParams as Params;

            if (params && Object.keys(params).length > 0) {
              fullPath += `?${qsStringify(params)}`;
            }

            const { data: result } = await axios.get(fullPath, {
              params: undefined,
            });

            return result;
          },
          async first(params?: Params) {
            let fullPath = `${path}/first`;
            if (params) {
              fullPath += `?${qsStringify(params)}`;
            }

            const { data: result } = await axios.get(fullPath, {
              params: undefined,
            });

            return result;
          },
          async count(params?: Params) {
            let fullPath = `${path}/count`;
            if (params && Object.keys(params).length > 0) {
              fullPath += `?${qsStringify(params)}`;
            }

            const { data: result } = await axios.get(fullPath, {
              params: undefined,
            });

            return result;
          },
          async ids(params?: Params) {
            let fullPath = `${path}/ids`;
            if (params && Object.keys(params).length > 0) {
              fullPath += `?${qsStringify(params)}`;
            }

            const { data: result } = await axios.get(fullPath, {
              params: undefined,
            });

            return result;
          },
        },
        rebind: (getUrl: (url: string) => any) => {
          return this.handlersFor({
            getUrl,
            cache,
            handleChanges,
          });
        },
      }
    );
  }
}

export function table<
  Config extends TableConfig<{}, {}>,
  Extension = {},
  Item = Config extends TableConfig<infer Item, any> ? Item : never,
  Row = Config extends TableConfig<any, infer Row> ? Row : never
>(path: string, options: Options = {}) {
  return new Table<Item, Row, Extension>(path, options);
}

export function core<Routes extends Record<string, Table<any, any, {}>>>(
  routes: Routes
) {
  const context = createContext<null | CoreCache>(null);

  function Provider({
    cache,
    children,
  }: {
    cache: CoreCache;
    children: ReactNode;
  }) {
    return <context.Provider value={cache}>{children}</context.Provider>;
  }

  function useCache() {
    const cache = useContext(context);
    if (!cache) throw new Error("core provider not found");
    return cache;
  }

  const handledChangeIds: string[] = [];
  let waitForUnlockPromise: Promise<void> | null = null;

  async function handleChanges(cache: CoreCache, changes: Change[]) {
    await cache.touch((url: string) => {
      const tables = Object.values(routes);

      return changes.some((change) => {
        const foundTables = tables.filter(
          (table) =>
            table.path === change.path ||
            (change.views && change.views.some((path) => path === table.path))
        );
        const touched = foundTables.some((table) =>
          table.shouldTouch(change, url)
        );

        return touched;
      });
    });
  }

  function useSSE() {
    const cache = useCache();
    return function sse(url: string) {
      const eventSource = new EventSource(url);

      eventSource.addEventListener("update", async (m: any) => {
        const { changeId, changes } = JSON.parse(m.data) as {
          changeId: string;
          changes: Change[];
        };

        if (waitForUnlockPromise) await waitForUnlockPromise;

        if (handledChangeIds.includes(changeId)) {
          handledChangeIds.splice(
            handledChangeIds.findIndex((i) => i === changeId),
            1
          );
          return;
        }

        await handleChanges(cache, changes);
      });

      return eventSource;
    };
  }

  function blockUpdatesById(id: string) {
    handledChangeIds.push(id);
  }

  async function lock<T>(fn: () => Promise<T>) {
    let result: T | undefined;
    let resolve: (() => void) | null = null;
    waitForUnlockPromise = new Promise<void>((r) => (resolve = r));

    try {
      result = await fn();
    } finally {
      waitForUnlockPromise = null;
      resolve!();
    }

    return result;
  }

  function useGetUrl() {
    const cache = useCache();
    return cache.useGet();
  }

  function useTouch() {
    const cache = useCache();

    return cache.touch.bind(cache);
  }

  Object.values(routes).map((table) => {
    table.blockUpdatesById = blockUpdatesById;
    table.lock = lock;
  });

  return {
    Provider,
    useTouch,
    useGetUrl,
    useSSE,
    useCore(): {
      [name in keyof Routes]: Routes[name] extends Table<
        infer Item,
        infer Row,
        infer Extension
      >
        ? Handlers<Item, Row, Extension>
        : never;
    } {
      const cache = useCache();
      const getUrl = cache.useGet();

      //@ts-expect-error
      return Object.fromEntries(
        Object.entries(routes).map(([key, table]) => {
          return [
            key,
            table.handlersFor({
              getUrl,
              cache,
              handleChanges: (changes: Change[]) =>
                handleChanges(cache, changes),
            }),
          ];
        })
      );
    },
  };
}
