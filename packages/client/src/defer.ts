import { isPromise } from "./isPromise";

export function defer<T>(call: () => T) {
  try {
    return { data: call(), isLoading: false };
  } catch (e) {
    if (!isPromise(e)) throw e;

    return { data: undefined, isLoading: true };
  }
}
