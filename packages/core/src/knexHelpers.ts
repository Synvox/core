import pg from "pg";
import { toSnakeCase, toCamelCase } from "./case";

pg.types.setTypeParser(20, "text", Number);

const knexHelpers = {
  wrapIdentifier: (value: string) => toSnakeCase(value),
  postProcessResponse: (value: string) => transformKeys(value, toCamelCase),
};

export default knexHelpers;

function transformKeys(obj: any, method: (word: string) => string): any {
  if (typeof obj !== "object" || obj === null) return obj;
  if (Array.isArray(obj)) return obj.map((item) => transformKeys(item, method));

  if (obj instanceof Date) return obj;

  return Object.fromEntries(
    Object.entries(obj).map(([key, value]) => [
      method(key),
      transformKeys(value, method),
    ])
  );
}
