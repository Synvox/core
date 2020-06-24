import pg from 'pg';

pg.types.setTypeParser(20, 'text', Number);

const knexHelpers = {
  wrapIdentifier: (value: any) => transformKey(value, caseMethods.snake),
  postProcessResponse: (value: any) => transformKeys(value, caseMethods.camel),
};

export default knexHelpers;

export const caseMethods = {
  camel(word: string, index: number) {
    return index === 0 ? word : word[0].toUpperCase() + word.slice(1);
  },
  snake(word: string, index: number) {
    return index === 0 ? word : '_' + word;
  },
  pascal(word: string, _index: number) {
    return word[0].toUpperCase() + word.slice(1);
  },
};

export function transformKey(
  key: string,
  method: (word: string, index: number) => string
) {
  return key
    .replace(/(\b|^|[a-z])([A-Z])/g, '$1_$2')
    .trim()
    .toLowerCase()
    .split('_')
    .reduce(
      (str, word, index) => str + method(word, index),
      key.startsWith('_') ? '_' : ''
    );
}

export function transformKeys(
  obj: any,
  method: (word: string, index: number) => string
): any {
  if (typeof obj !== 'object' || obj instanceof Date) return obj;
  if (!obj) return obj;
  if (Array.isArray(obj)) return obj.map(item => transformKeys(item, method));

  return Object.keys(obj)
    .map(key => ({ key, value: transformKeys(obj[key], method) }))
    .map(({ key, value }) => ({
      value,
      key: transformKey(key, method),
    }))
    .reduce(
      (returned, { key, value }) => Object.assign(returned, { [key]: value }),
      {}
    );
}
