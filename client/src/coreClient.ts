import { Cache, createLoader } from ".";
import { AxiosInstance } from "axios";
import qs from "qs";

function qsStringify(val: any) {
  return qs.stringify(val, {
    encodeValuesOnly: true,
    arrayFormat: "brackets",
  });
}

type Collection<T> = T[] & { hasMore: boolean };
type ChangeTo<T> = {
  data: T;
  changes: {
    mode: "string";
    schemaName: string;
    tableName: "string";
    row: unknown;
  }[];
};

type Getter<Result, Params extends Record<string, any>> = ((
  idOrParams: number | string,
  params?: Params
) => Result) &
  ((idOrParams?: Params) => Collection<Result>);

type Route<Result, Params extends Record<string, any>> = Getter<
  Result,
  Params
> & {
  get: Getter<Result, Params>;
  put: (id: number | string, payload: any) => Promise<ChangeTo<Result>>;
  post: (payload: any) => Promise<ChangeTo<Result>>;
  delete: (id: number | string) => Promise<ChangeTo<Result>>;
};

export function table<T, P = {}>(path: string) {
  return (getUrl: (key: string) => unknown, axios: AxiosInstance) => {
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
          return result as ChangeTo<T>;
        },
        post: async (data: any, params?: P) => {
          let fullPath = path;
          if (params && Object.keys(params).length > 0) {
            fullPath += `?${qsStringify(params)}`;
          }
          const { data: result } = await axios.put(fullPath, data);
          return result as ChangeTo<T>;
        },
        delete: async (id: number | string, params?: P) => {
          let fullPath = `${path}/${id}`;
          if (params && Object.keys(params).length > 0) {
            fullPath += `?${qsStringify(params)}`;
          }
          const { data: result } = await axios.put(fullPath);
          return result as ChangeTo<T>;
        },
      }
    ) as Route<T, P>;
  };
}

type RouteFactory<Result, Params> = (
  getUrl: (url: string) => any,
  axios: AxiosInstance
) => Route<Result, Params>;

export function coreClient<
  Routes extends Record<string, RouteFactory<any, any>>
>(axios: AxiosInstance, routes: Routes) {
  const cache = new Cache<string>(async (url) => {
    let { data } = await axios.get(url);
    const result: [string, any][] = [];

    function walk(obj: any): any {
      if (!obj || typeof obj !== "object") return obj;
      if (Array.isArray(obj)) return obj.map(walk);

      return Object.fromEntries(
        Object.entries(obj).map(([key, obj]: [string, any]) => {
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

  return {
    touch,
    useGetUrl,
    preload,
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
          return [key, createRoute(getUrl, axios)];
        })
      );
    },
  };
}

// const { useCore } = coreClient(axios, {
//   users: table<
//     { id: string; firstName: string },
//     { id: string; include: string }
//   >("/auth/users"),
// });

// const core = useCore();
// const a = core.users.get("a", { include: "abc" });
// const b = core.users();
