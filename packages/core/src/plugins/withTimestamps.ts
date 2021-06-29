import { TableDef } from "../types";

/**
 * Updates created_at and updated_at timestamps on update and insert
 * Adds a ?since=timestamp query parameter
 * @example
 *     core.table(withTimestamps({ ... table config ... }))
 * @param table
 */
export default function withTimestamps<T>(table: TableDef<T>): TableDef<T> {
  return {
    ...table,
    queryModifiers: {
      async since(value, query) {
        const date = new Date(value);
        if (isNaN(date.getTime())) return;

        query.where(`${this.alias}.updatedAt`, ">", date);
      },
      ...table.queryModifiers,
    },
    async enforcedParams(context, mode) {
      const params = {
        ...(table.enforcedParams
          ? await table.enforcedParams(context, mode)
          : {}),
      };
      const date = new Date(Date.now());
      params.updatedAt = date;
      if (mode === "insert") params.createdAt = date;
      delete params.createdAt;

      return params;
    },
  };
}
