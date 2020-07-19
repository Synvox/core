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
      async since(value, query) {
        const date = new Date(value);
        if (isNaN(date.getTime())) return;

        query.where(`${this.alias}.updatedAt`, '>', date);
      },
      ...table.queryModifiers,
    },
    async beforeUpdate(trx, row, mode, authorizer) {
      if (table.beforeUpdate)
        await table.beforeUpdate.call(this, trx, row, mode, authorizer);

      row.updatedAt = new Date(Date.now());

      if (mode === 'insert') row.createdAt = new Date(Date.now());
      else delete row.createdAt;
    },
  };
}
