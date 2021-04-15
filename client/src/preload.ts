import { isPromise } from "./isPromise";

export async function preload<T>(fn: () => T) {
  while (true) {
    try {
      return fn();
    } catch (e) {
      if (!isPromise(e)) throw e;
      await e;
    }
  }
}
