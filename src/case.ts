import { camelize, underscore } from "inflection";

export const toCamelCase = (str: string = "") => camelize(str, true);
export const toSnakeCase = (str: string = "") => underscore(str, false);
