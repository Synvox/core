export function isPromise(value: any): value is Promise<unknown> {
  return (
    value &&
    (typeof value === "object" || typeof value === "function") &&
    typeof value.then === "function"
  );
}
