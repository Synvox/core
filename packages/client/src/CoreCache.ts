import Debug from "debug";
import { AxiosInstance } from "axios";
import { useState, useEffect, useRef } from "react";
import { Entry, Subscriber } from "./types";

const debug = Debug("core");

let updateNumber = 0;
const isBrowser = typeof window !== "undefined";

function nextUpdateNumber() {
  if (updateNumber >= Number.MAX_SAFE_INTEGER) updateNumber = 0;
  return ++updateNumber;
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

  export() {
    return Object.fromEntries(
      Object.entries(this.cache)
        .map(([key, { data, error, loadedThrough }]) => {
          if (loadedThrough !== key) return [key, null];
          return [
            key,
            {
              data: JSON.parse(JSON.stringify(data)),
              error: error ? error.message : undefined,
            },
          ];
        })
        .filter(([_, o]) => o)
    );
  }
  static restore(axios: AxiosInstance, obj: Record<string, Entry<unknown>>) {
    const coreCache = new CoreCache(axios);

    for (let [url, { data, error }] of Object.entries(obj)) {
      coreCache.cache[url] = {
        data,
        error: error ? new Error(String(error)) : undefined,
        loadedThrough: url,
        subscribers: new Set(),
      };

      if (error) continue;

      const processed = coreCache.processResponse(data);

      for (let subUrl in processed) {
        const data = processed[subUrl];

        coreCache.cache[subUrl] = {
          data,
          loadedThrough: url,
          subscribers: new Set(),
        };
      }
    }

    return coreCache;
  }

  get<T>(url: string) {
    debug("get from cache", url);
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
    debug("loading", url);
    let changes: Record<string, Partial<Entry<unknown>>> = {};
    try {
      const { data } = await this.axios.get(url);

      const processed = this.processResponse(data);
      changes = { [url]: { promise: undefined, error: undefined, data } };
      for (let url in processed) {
        debug("staging resource", url);
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
      debug("commit");
      Object.entries(changes).map(([subUrl, change]) => {
        this.cache[subUrl] = {
          ...(this.cache[subUrl] ?? {
            subscribers: new Set(),
          }),
          ...change,
          loadedThrough: url,
        };

        if (isBrowser && this.cache[url].subscribers.size === 0) {
          if (this.cache[url].refreshTimeout)
            window.clearTimeout(this.cache[url].refreshTimeout!);
          this.cache[url].refreshTimeout = setTimeout(() => {
            this.refresh(url);
          }, 1000 * 60 * 10);
        }
      });

      const update = () => {
        debug("update");
        if (!isBrowser) return;
        const subscribers = Array.from(this.cache[url].subscribers);
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
      debug("subscribing to", used);
      for (let url of used) {
        const entry = this.cache[url];
        if (!entry) continue;
        entry.subscribers.add(forceUpdate);
        if (entry.refreshTimeout) {
          clearTimeout(entry.refreshTimeout);
          entry.refreshTimeout = undefined;
        }
      }

      return () => {
        debug("unsubscribing from", used);
        for (let url of used) {
          const entry = this.cache[url];
          if (!entry) continue;
          entry.subscribers.delete(forceUpdate);
          if (isBrowser && entry.subscribers.size === 0) {
            if (entry.refreshTimeout) window.clearTimeout(entry.refreshTimeout);
            entry.refreshTimeout = setTimeout(() => {
              this.refresh(url);
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

    debug("touch matched", matchedUrls);
    return await this.refresh(...matchedUrls);
  }

  isUrlDependedOn(url: string) {
    return Object.entries(this.cache).some(
      ([key, { loadedThrough }]) => key !== url && loadedThrough === url
    );
  }

  async refresh(...matchedUrls: string[]) {
    const pendingPromises: Record<string, Promise<() => Subscriber>> = {};
    debug("refreshing", matchedUrls);
    for (let url of matchedUrls) {
      debug("refreshing", url);
      const entry = this.cache[url];
      if (!entry) {
        debug("no entry exists for", url);
        continue;
      }

      if (entry.refreshTimeout) {
        window.clearTimeout(entry.refreshTimeout);
        entry.refreshTimeout = undefined;
      }

      if (this.isUrlDependedOn(url)) {
        debug("entry is depended on, skipping", url);
        // trying to refresh a
        entry.refreshTimeout = setTimeout(() => {
          this.refresh(url);
        }, 1000 * 60 * 10);
      } else if (entry.subscribers.size === 0) {
        debug("entry is not used on page, deleting", url);
        delete this.cache[url];

        if (
          entry.loadedThrough !== url &&
          !this.isUrlDependedOn(entry.loadedThrough)
        ) {
          debug("adding refresh for parent", url);
          matchedUrls.push(entry.loadedThrough);
        }

        continue;
      }

      debug("now refreshing", url);
      let promise =
        pendingPromises[entry.loadedThrough] || pendingPromises[url];

      if (!promise) {
        debug("needs new promise", url);
        promise = this.load(entry.loadedThrough);
        pendingPromises[url] = promise;
        pendingPromises[entry.loadedThrough] = promise;
      }

      this.cache[url] = {
        ...entry,
        promise: promise.then(() => {}),
      };
    }

    const commitFunctions = await Promise.all(Object.values(pendingPromises));

    debug("committing new changes");
    const updateFunctions = commitFunctions.map((commit) => commit());

    for (let url in pendingPromises) {
      if (this.cache[url]?.promise) {
        // a resource has left a url but still contains a promise
        this.cache[url].promise = undefined;
      }
    }

    const num = nextUpdateNumber();
    debug("updating page");
    for (let update of updateFunctions) {
      update(num);
    }
  }

  reset() {
    for (let key in this.cache) delete this.cache[key];
  }
}
