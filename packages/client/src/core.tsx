import { useContext, createContext, ReactNode } from "react";
import qs from "qs";
import { Collection, Change, ChangeTo, Handlers, ID } from "./types";
import { AxiosInstance } from "axios";
import Cache from "./cache";
import { createLoader } from "./createLoader";

function qsStringify(val: any) {
  return qs.stringify(val, {
    encodeValuesOnly: true,
    arrayFormat: "brackets",
  });
}

type Options = {
  shouldTouch?: (change: Change, url: string) => boolean;
};

class Table<Result, Params, IDColumnName> {
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
    getUrl: realGetUrl,
    axios,
    handleChanges,
  }: {
    getUrl: (url: string) => any;
    axios: AxiosInstance;
    handleChanges: (changes: Change[]) => Promise<void>;
  }): Handlers<Result, Params, IDColumnName> {
    const { path, lock, blockUpdatesById } = this;

    function getUrl(url: string) {
      return realGetUrl(url);
    }

    function get(
      idOrParams?: ID<Params, IDColumnName> | Params,
      params?: Params
    ) {
      if (typeof idOrParams === "object") {
        return getUrl(`${path}?${qsStringify(idOrParams)}`) as Result;
      } else {
        let fullPath = path;

        if (idOrParams) fullPath += `/${idOrParams}`;

        if (params && Object.keys(params).length > 0) {
          fullPath += `?${qsStringify(params)}`;
        }

        return getUrl(fullPath) as Collection<Result>;
      }
    }

    return Object.assign(
      (idOrParams?: ID<Params, IDColumnName> | Params, params?: Params) =>
        get(idOrParams, params),
      {
        get: get,
        first(params?: Params) {
          let fullPath = `${path}/first`;
          if (params) {
            fullPath += `?${qsStringify(params)}`;
          }

          return getUrl(fullPath) as Result;
        },
        async put(
          idOrQuery: ID<Result, IDColumnName> | Params,
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
            return result as ChangeTo<Result>;
          });
        },
        async post<ReturnValue = ChangeTo<Result>>(
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
        async delete(id: ID<Params, IDColumnName>, params?: Params) {
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
            return result as ChangeTo<Result>;
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
          return getUrl(fullPath) as Collection<ID<Result, IDColumnName>>;
        },
        async getAsync(
          idOrParams?: ID<Params, IDColumnName> | Params,
          params?: Params
        ) {
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
        async countAsync(params?: Params) {
          let fullPath = `${path}/count`;
          if (params && Object.keys(params).length > 0) {
            fullPath += `?${qsStringify(params)}`;
          }

          const { data: result } = await axios.get(fullPath, {
            params: undefined,
          });

          return result;
        },
        async idsAsync(params?: Params) {
          let fullPath = `${path}/ids`;
          if (params && Object.keys(params).length > 0) {
            fullPath += `?${qsStringify(params)}`;
          }

          const { data: result } = await axios.get(fullPath, {
            params: undefined,
          });

          return result;
        },
      }
    ) as Handlers<Result, Params, IDColumnName>;
  }
}

export function table<T, P, IDColumnName extends string | number = "id">(
  path: string,
  options: Options = {}
) {
  return new Table<T, P, IDColumnName>(path, options);
}

const axiosContext = createContext<AxiosInstance | null>(null);

export function AxiosProvider({
  axios,
  children,
}: {
  axios: AxiosInstance;
  children: ReactNode;
}) {
  return (
    <axiosContext.Provider value={axios}>{children}</axiosContext.Provider>
  );
}

export function core<Routes extends Record<string, Table<any, any, any>>>(
  axios: AxiosInstance,
  routes: Routes
) {
  const cache = new Cache<string, AxiosInstance>(async (url, axios) => {
    let { data } = await axios!.get(url);
    const result: [string, any][] = [];
    function walk(obj: any): any {
      if (!obj || typeof obj !== "object") return obj;
      if (Array.isArray(obj)) return obj.map((o) => walk(o));

      const walkedChild = Object.fromEntries(
        Object.entries(obj).map(([key, obj]: [string, any]) => [key, walk(obj)])
      );

      if (obj._url) {
        const url = obj._url;
        result.push([url, obj]);
      }

      if (typeof obj._links === "object") {
        for (let [key, value] of Object.entries(obj._links)) {
          if (obj[key] !== undefined) {
            result.push([value as string, obj[key]]);
          }
        }
      }

      return walkedChild;
    }

    data = walk(data);

    if (!result.some((r) => r[0] === url)) result.push([url, data]);

    return result;
  });

  const { useKey: useGetUrl, touch } = createLoader({
    cache,
    modifier(obj: any, get) {
      let result = Array.isArray(obj) ? [...obj] : { ...obj };

      function walk(obj: any): any {
        if (!obj || typeof obj !== "object") return obj;
        const isArray = Array.isArray(obj);
        const returned: any = isArray ? [] : {};

        const properties = Object.getOwnPropertyDescriptors(obj);

        for (let [key, prop] of Object.entries<any>(properties)) {
          if (prop.value?._url) {
            Object.defineProperty(returned, key, {
              get() {
                return get(prop.value._url as string);
              },
              enumerable: isArray,
              configurable: true,
            });
          } else if ("value" in prop && prop.configurable) {
            const walkedValue = walk(prop.value);
            Object.defineProperty(returned, key, {
              ...prop,
              value: walkedValue,
              enumerable: !key.startsWith("_") && prop.enumerable !== false,
              configurable: true,
            });
          } else if (prop.configurable) {
            Object.defineProperty(returned, key, prop);
          }
        }

        const { _links: links = {} } = obj;

        for (let [key, url] of Object.entries(links)) {
          // including arrays has a special case
          // because it doesn't load pagination data.
          if (!Array.isArray(returned[key])) {
            Object.defineProperty(returned, key, {
              get() {
                return get(url as string);
              },
              enumerable: false,
              configurable: true,
            });
          }
        }

        return returned;
      }

      if (result && result.items && Array.isArray(result.items)) {
        const { items: itemsDirect, ...others } = result;
        result = (itemsDirect as any[]).slice();
        const properties = Object.fromEntries(
          Object.entries(others).map(([key, value]) => [
            key,
            {
              value,
              enumerable: false,
              configurable: true,
            },
          ])
        );

        Object.defineProperties(result, properties);
      }

      const returned = walk(result);

      return returned;
    },
  });

  const handledChangeIds: string[] = [];
  let waitForUnlockPromise: Promise<void> | null = null;

  async function handleChanges(changes: Change[]) {
    await touch((url) => {
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

  function sse(url: string) {
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

      await handleChanges(changes);
    });

    return eventSource;
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

  Object.values(routes).map((table) => {
    table.blockUpdatesById = blockUpdatesById;
    table.lock = lock;
  });

  return {
    cache,
    touch,
    useGetUrl,
    sse,
    useCore(): {
      [name in keyof Routes]: Routes[name] extends Table<
        infer Result,
        infer Params,
        infer ID
      >
        ? Handlers<Result, Partial<Params>, ID>
        : never;
    } {
      const givenAxios = useContext(axiosContext);
      const getUrl = useGetUrl();

      //@ts-expect-error
      return Object.fromEntries(
        Object.entries(routes).map(([key, table]) => {
          return [
            key,
            table.handlersFor({
              getUrl(url) {
                return getUrl(url, givenAxios ?? axios);
              },
              axios: givenAxios ?? axios,
              handleChanges,
            }),
          ];
        })
      );
    },
  };
}
