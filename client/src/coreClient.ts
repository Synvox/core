import { Cache, createLoader } from ".";
import axios, { AxiosInstance } from "axios";
import qs from "qs";

function qsStringify(val: any) {
  return qs.stringify(val, {
    encodeValuesOnly: true,
    arrayFormat: "brackets",
  });
}

type Collection<T> = T[] & { hasMore: boolean };

type Getter<Result, Params extends Record<string, any>> = ((
  idOrParams: number | string,
  params?: Params
) => Result) &
  ((idOrParams?: Params) => Collection<Result>);

function table<T, P = {}>(path: string) {
  return (getUrl: (key: string) => unknown) => {
    //@ts-expect-error
    const getter: Getter<T, P> = (
      idOrParams?: number | string | P,
      params?: P
    ) => {
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

    return getter;
  };
}

type Route<Result, Params> = (
  getUrl: (url: string) => any
) => Getter<Result, Params>;

export function coreClient<Routes extends Record<string, Route<any, any>>>(
  axios: AxiosInstance,
  routes: Routes
) {
  const cache = new Cache<string>(async (url) => {
    const { data } = await axios.get(url);
    const result: [string, any][] = [[url, data]];

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

    walk(data);

    return result;
  });

  const { useKey: useGetUrl, touch, preload } = createLoader({
    cache,
    modifier(obj, get) {
      function walk(obj: any): any {
        if (!obj || typeof obj !== "object") return obj;
        if (Array.isArray(obj)) return obj.map(walk);
        return Object.fromEntries(
          Object.entries(obj).map(
            ([key, { _links: links, ...value }]: [string, any]) => {
              if (links) {
                return Object.defineProperties(
                  { ...value },
                  Object.fromEntries(
                    Object.entries(links).map(([key, href]: [string, any]) => [
                      key,
                      {
                        get() {
                          return get(href);
                        },
                      },
                    ])
                  )
                );
              } else return [key, value];
            }
          )
        );
      }

      return walk(obj);
    },
  });

  return {
    touch,
    useGetUrl,
    preload,
    useCore(): {
      [name in keyof Routes]: Routes[name] extends Route<
        infer Result,
        infer Params
      >
        ? Getter<Result, Partial<Params>>
        : Getter<unknown, any>;
    } {
      const getUrl = useGetUrl();

      //@ts-expect-error
      return Object.fromEntries(
        Object.entries(routes).map(([key, createRoute]) => {
          return [key, createRoute(getUrl)];
        })
      );
    },
  };
}

const { useCore } = coreClient(axios, {
  users: table<
    { id: string; firstName: string },
    { id: string; include: string }
  >("/auth/users"),
});

const core = useCore();
const a = core.users("a", { include: "abc" });
const b = core.users();
