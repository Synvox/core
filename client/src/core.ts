import { Cache, createLoader } from ".";
import qs from "qs";
import { RouteFactory, Collection, Change, ChangeTo, Route } from "./types";
import { AxiosInstance } from "axios";

function qsStringify(val: any) {
  return qs.stringify(val, {
    encodeValuesOnly: true,
    arrayFormat: "brackets",
  });
}

export function table<T, P = {}>(path: string) {
  const routeFactory: RouteFactory<T, P> = ({
    getUrl,
    axios,
    blockUpdatesById,
    handleChanges,
  }) => {
    const getter = (idOrParams?: number | string | P, params?: P) => {
      if (typeof idOrParams === "object") {
        return getUrl(`${path}?${qsStringify(idOrParams)}`) as T;
      } else {
        let fullPath = path;

        if (idOrParams) fullPath += `/${idOrParams}`;

        if (params && Object.keys(params).length > 0) {
          fullPath += `?${qsStringify(params)}`;
        }

        return getUrl(fullPath) as Collection<T>;
      }
    };

    return Object.assign(
      (idOrParams?: number | string | P, params?: P) =>
        getter(idOrParams, params),
      {
        get: getter,
        put: async (id: number | string, data: any, params?: P) => {
          let fullPath = `${path}/${id}`;
          if (params && Object.keys(params).length > 0) {
            fullPath += `?${qsStringify(params)}`;
          }
          const { data: result } = await axios.put(fullPath, data);
          if (result.changeId) blockUpdatesById(result.changeId);
          result.update = () => handleChanges(result.changes);
          return result as ChangeTo<T>;
        },
        post: async (data: any, params?: P) => {
          let fullPath = path;
          if (params && Object.keys(params).length > 0) {
            fullPath += `?${qsStringify(params)}`;
          }
          const { data: result } = await axios.post(fullPath, data);
          if (result.changeId) blockUpdatesById(result.changeId);
          result.update = () => handleChanges(result.changes);
          return result as ChangeTo<T>;
        },
        delete: async (id: number | string, params?: P) => {
          let fullPath = `${path}/${id}`;
          if (params && Object.keys(params).length > 0) {
            fullPath += `?${qsStringify(params)}`;
          }
          const { data: result } = await axios.delete(fullPath);
          if (result.changeId) blockUpdatesById(result.changeId);
          result.update = () => handleChanges(result.changes);
          return result as ChangeTo<T>;
        },
      }
    ) as Route<T, P>;
  };

  return routeFactory;
}

export function core<Routes extends Record<string, RouteFactory<any, any>>>(
  axios: AxiosInstance,
  routes: Routes
) {
  const cache = new Cache<string>(async (url) => {
    let { data } = await axios.get(url);
    const result: [string, any][] = [];

    function walk(obj: any): any {
      if (!obj || typeof obj !== "object") return obj;
      if (Array.isArray(obj)) return obj.map(walk);

      return Object.fromEntries(
        Object.entries(obj).map(([key, obj]: [string, any]) => {
          if (obj && typeof obj === "object") {
            if (obj._url) {
              result.push([obj._url, obj]);
            }

            if (obj._links) {
              for (let linkName in obj._links) {
                if (obj[linkName]) {
                  walk(obj[linkName]);
                  delete obj[linkName];
                }
              }
            }
          }

          return [key, walk(obj)];
        })
      );
    }

    data = walk(data);

    if (data.meta && data.data && Array.isArray(data.data))
      data.data = Object.assign(data.data, data.meta);

    if (data.data !== undefined) data = data.data;

    result.push([url, data]);

    return result;
  });

  const { useKey: useGetUrl, touch, preload } = createLoader({
    cache,
    modifier(obj, get) {
      function walk(obj: any): any {
        if (!obj || typeof obj !== "object") return obj;
        if (Array.isArray(obj)) return obj.map(walk);

        const returned: any = Array.isArray(obj) ? [] : {};

        for (let [key, value] of Object.entries(obj)) {
          returned[key] = walk(value);
        }

        const { _links: links } = obj;
        if (!links) return returned;

        for (let [key, url] of Object.entries(links)) {
          if (!obj[key]) {
            Object.defineProperty(returned, key, {
              get() {
                return get(url as string);
              },
              enumerable: false,
              configurable: false,
            });
          }
        }

        return returned;
      }

      return walk(obj);
    },
  });

  const handledChangeIds: string[] = [];
  async function handleChanges(changes: Change[]) {
    await touch((url: string) => {
      return changes.some((change) => url.includes(change.path));
    });
  }

  function sse(url: string) {
    const eventSource = new EventSource(url);

    eventSource.addEventListener("update", (m: any) => {
      const { changeId, changes } = JSON.parse(m.data);
      if (handledChangeIds.includes(changeId)) return;
      handleChanges(changes);
    });

    return eventSource;
  }

  function blockUpdatesById(id: string) {
    handledChangeIds.push(id);
  }

  return {
    touch,
    useGetUrl,
    preload,
    sse,
    useCore(): {
      [name in keyof Routes]: Routes[name] extends RouteFactory<
        infer Result,
        infer Params
      >
        ? Route<Result, Partial<Params>>
        : Route<unknown, any>;
    } {
      const getUrl = useGetUrl();

      //@ts-expect-error
      return Object.fromEntries(
        Object.entries(routes).map(([key, createRoute]) => {
          return [
            key,
            createRoute({ getUrl, axios, handleChanges, blockUpdatesById }),
          ];
        })
      );
    },
  };
}
