import { TableDef } from '../types';

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

        query.where(`${this.alias}.updatedAt`, '>', date);
      },
      ...table.queryModifiers,
    },
    async beforeUpdate(trx, context, mode, draft, current) {
      if (table.beforeUpdate)
        await table.beforeUpdate.call(this, trx, context, mode, draft, current);

      // if the row was hard deleted
      if (!draft) return;

      draft.updatedAt = new Date(Date.now());

      if (mode === 'insert') draft.createdAt = new Date(Date.now());
      else delete draft.createdAt;
    },
  };
}
