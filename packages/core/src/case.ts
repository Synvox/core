export const toCamelCase = (str: string = "") =>
  str.replace(/(?<!_)(_([^_]))/g, (_1, _2, r) => r.toUpperCase());
export const toSnakeCase = (str: string = "") =>
  str.replace(/[a-z0-9]([A-Z])[A-Z]*/g, (str) => {
    const [a, b] = str.split("");
    return `${a}_${b.toLowerCase()}`;
  });
