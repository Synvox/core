import { PartialTable } from '../Table';

/**
 * Updates created_at and updated_at timestamps on update and insert
 * Adds a ?since=timestamp query parameter
 * @example
 *     core.register(withTimestamps({ ... table config ... }))
 * @param table
 */
export default function withTimestamps<T>(
  table: PartialTable<T>
): PartialTable<T> {
  return {
    ...table,
    queryModifiers: {
      since: async (value, query) => {
        const date = new Date(value);
        if (isNaN(date.getTime())) return;

        query.where(`${table.tableName}.updatedAt`, '>', date);
      },
      ...table.queryModifiers,
    },
    beforeHook: async (trx, row, mode, authorizer) => {
      if (table.beforeHook) await table.beforeHook(trx, row, mode, authorizer);

      row.updatedAt = new Date();

      if (mode === 'insert') row.createdAt = new Date();
      else delete row.createdAt;
    },
  };
}
