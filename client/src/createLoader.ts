import {
  useState,
  useEffect,
  useRef,
  useCallback,
  useLayoutEffect,
} from "react";
import Cache from "./cache";
import { isPromise } from "./isPromise";
import { Touch } from "./types";

function useForceUpdate() {
  const forceUpdateInner = useState({})[1];
  const mountedStateRef = useRef(true);

  useEffect(() => {
    return () => {
      mountedStateRef.current = false;
    };
  }, []);

  const forceUpdate = useCallback(() => {
    if (mountedStateRef.current) forceUpdateInner({});
  }, []);

  return forceUpdate;
}

export function createLoader<Key>({
  cache,
  modifier = (x: any) => x,
}: {
  cache: Cache<Key>;
  modifier?: <In, Out>(obj: In, get: <T>(key: Key) => T) => Out;
}) {
  function get<Result>(key: Key) {
    const cacheEntry = cache.get<Result>(key);
    if (cacheEntry) {
      if (cacheEntry.data !== undefined) return cacheEntry.data;
      if (cacheEntry.promise !== undefined) throw cacheEntry.promise;
      if (cacheEntry.error !== undefined) throw cacheEntry.error;
    }

    throw cache.load(key).then((commit) => commit());
  }

  function useKey() {
    type DataMapValue = { keys: Set<Key>; value: unknown };
    const subscription = useForceUpdate();
    const previouslySubscribedKeysRef = useRef<Set<Key>>(new Set());
    const subscribedKeysRef = useRef<Set<Key>>(new Set());
    const dataMap = useState<WeakMap<object, DataMapValue>>(
      () => new WeakMap()
    )[0];

    const previouslySubscribedKeys = previouslySubscribedKeysRef.current;

    subscribedKeysRef.current.forEach((key) =>
      previouslySubscribedKeys.add(key)
    );
    subscribedKeysRef.current = new Set<Key>();
    const subscribedKeys = subscribedKeysRef.current;

    const hookGet = <Result>(key: Key, subKeys: Set<Key> = subscribedKeys) => {
      subKeys.add(key);
      try {
        const result = get<any>(key);

        if (result === null || typeof result !== "object") return result;

        if (dataMap.has(result)) {
          const { keys, value } = dataMap.get(result) as DataMapValue;
          keys.forEach((key) => subKeys.add(key));
          return value as Result;
        }

        const modifierKeys = new Set<Key>();
        const modifiedResult: Result = modifier<any, Result>(
          result,
          (key: Key) => hookGet(key, modifierKeys)
        );

        dataMap.set(result, { keys: modifierKeys, value: modifiedResult });

        return modifiedResult;
      } catch (e) {
        const thrown = e as Error | Promise<Result>;

        if (!isPromise(thrown)) {
          throw e;
        }

        thrown.finally(() => subscription());

        throw thrown;
      }
    };

    useLayoutEffect(() => {
      subscribedKeys.forEach((key) => {
        cache.subscribe(key, subscription);
      });
    });

    // unsubscribe from previously used keys
    useEffect(() => {
      Array.from(previouslySubscribedKeys)
        .filter((key) => !subscribedKeys.has(key))
        .forEach((key) => {
          previouslySubscribedKeys.delete(key);
          cache.unsubscribe(key, subscription);
        });

      subscribedKeys.forEach((key) => {
        previouslySubscribedKeys.add(key);
        cache.subscribe(key, subscription);
      });
    });

    useEffect(() => {
      return () => {
        previouslySubscribedKeys.forEach((key) =>
          cache.unsubscribe(key, subscription)
        );
      };
    }, []);

    return hookGet;
  }

  async function preload<T>(fn: (g: typeof get) => T) {
    while (true) {
      try {
        return fn(get);
      } catch (e) {
        if (!isPromise(e)) throw e;
        await e;
      }
    }
  }

  async function touch(filter: (key: Key) => boolean) {
    await cache.touch(filter);
  }

  return {
    get,
    useKey,
    preload,
    touch: touch as Touch<Key>,
  };
}
