import { AxiosInstance } from "axios";
import { useState, useEffect, useRef } from "react";

type Entry<T> = {
  data?: T;
  promise?: Promise<void>;
  error?: Error;
  subscribers: Set<Subscriber>;
  removalTimeout?: ReturnType<typeof setTimeout>;
  loadedThrough: string;
};

type Subscriber = (number: number) => void;

let updateNumber = 0;

function nextUpdateNumber() {
  if (updateNumber >= Number.MAX_SAFE_INTEGER) updateNumber = 0;
  return updateNumber++;
}

function useUpdate() {
  const set = useState(updateNumber)[1];

  return set;
}

export class CoreCache {
  axios: AxiosInstance;
  cache: Record<string, Entry<unknown>>;

  constructor(axios: AxiosInstance) {
    this.axios = axios;
    this.cache = {};
  }

  get<T>(url: string) {
    const entry = this.cache[url];
    if (entry) return entry;

    const promise = this.load(url).then((commit) => {
      const update = commit();
      update();
    });

    const newEntry: Entry<T> = {
      promise,
      subscribers: new Set(),
      loadedThrough: url,
    };

    this.cache[url] = newEntry;

    return newEntry;
  }

  async load(url: string) {
    let changes: Record<string, Partial<Entry<unknown>>> = {};
    try {
      const { data } = await this.axios.get(url);

      const processed = this.processResponse(data);
      changes = { [url]: { promise: undefined, error: undefined, data } };
      for (let url in processed) {
        changes[url] = {
          promise: undefined,
          error: undefined,
          data: processed[url],
        };
      }
    } catch (e) {
      changes = {
        [url]: {
          promise: undefined,
          data: undefined,
          error: e,
        },
      };
    }

    const commit = () => {
      Object.entries(changes).map(([url, change]) => {
        this.cache[url] = {
          ...(this.cache[url] ?? {
            subscribers: new Set(),
          }),
          ...change,
          loadedThrough: url,
        };

        if (this.cache[url].subscribers.size === 0)
          this.cache[url].removalTimeout = setTimeout(() => {
            delete this.cache[url];
          }, 1000 * 60 * 10);
      });

      const update = () => {
        const subscribers = [...this.cache[url].subscribers];
        const num = nextUpdateNumber();
        for (let fn of subscribers) fn(num);
      };

      return update;
    };

    return commit;
  }

  processResponse(obj: any) {
    const urls: Record<string, any> = {};

    const walk = (obj: any) => {
      if (!obj || typeof obj !== "object") return obj;
      if (Array.isArray(obj)) {
        obj.map((o) => walk(o));
        return;
      }

      Object.fromEntries(
        Object.entries(obj).map(([key, obj]: [string, any]) => [key, walk(obj)])
      );

      if (obj._url) {
        const url = obj._url as string;
        urls[url] = obj;
      }

      if (typeof obj._links === "object") {
        for (let [key, value] of Object.entries(obj._links)) {
          if (obj[key] !== undefined) {
            const str = value as string;
            urls[str] = obj[key];
          }
        }
      }
    };

    walk(obj);

    return urls;
  }

  bindGetters(obj: any, get: (url: string) => any) {
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
  }

  useGet() {
    const forceUpdate = useUpdate();
    const mapRef = useRef<WeakMap<any, any>>(new WeakMap());
    const used: string[] = [];

    const get = (url: string) => {
      const entry = this.get(url);
      used.push(url);

      if (entry.data !== undefined) {
        if (typeof entry.data !== "object") return entry.data;
        const boundBefore = mapRef.current.get(entry.data);

        if (boundBefore !== undefined) return boundBefore;

        const boundNow = this.bindGetters(entry.data, get);
        mapRef.current.set(entry.data, boundNow);

        return boundNow;
      }
      if (entry.promise !== undefined) throw entry.promise;
      if (entry.error !== undefined) throw entry.error;
      throw new Error("unreachable");
    };

    useEffect(() => {
      for (let url of used) {
        const entry = this.get(url);
        entry.subscribers.add(forceUpdate);
        if (entry.removalTimeout) {
          clearTimeout(entry.removalTimeout);
          entry.removalTimeout = undefined;
        }
      }

      return () => {
        for (let url of used) {
          const entry = this.get(url);
          entry.subscribers.delete(forceUpdate);
          if (entry.subscribers.size === 0) {
            entry.removalTimeout = setTimeout(() => {
              delete this.cache[url];
            }, 1000 * 60 * 10);
          }
        }
      };
    });

    return get;
  }

  async touch(matcher: (url: string) => boolean) {
    const matchedUrls: string[] = [];

    for (let url in this.cache) {
      if (matcher(url)) matchedUrls.push(url);
    }

    const pendingPromises: Record<string, Promise<() => Subscriber>> = {};

    for (let url of matchedUrls) {
      const entry = this.cache[url];

      if (entry.subscribers.size === 0) {
        delete this.cache[url];
        continue;
      }

      let promise = pendingPromises[entry.loadedThrough];
      if (!promise) {
        promise = this.load(url);
        pendingPromises[url] = promise;
      }

      this.cache[url] = {
        ...entry,
        promise: promise.then(() => {}),
      };
    }

    const commitFunctions = await Promise.all(Object.values(pendingPromises));
    const updateFunctions = commitFunctions.map((commit) => commit());
    const num = nextUpdateNumber();
    for (let update of updateFunctions) update(num);
  }

  reset() {
    for (let key in this.cache) delete this.cache[key];
  }
}
