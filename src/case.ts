import { caseMethods, transformKey } from './knexHelpers';

export const toCamelCase = (str: string) =>
  transformKey(str, caseMethods.camel);
export const toSnakeCase = (str: string) =>
  transformKey(str, caseMethods.snake);
