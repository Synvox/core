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
    async afterUpdate(trx, context, mode, next, prev) {
      const stmt = trx(this.tablePath);
      if (next && (mode === "insert" || mode === "update")) {
        stmt.where(this.idColumnName, next[this.idColumnName]);

        if (this.tenantIdColumnName)
          stmt.where(this.tenantIdColumnName, next[this.tenantIdColumnName]);

        if (mode === "insert") {
          if (
            this.columns["createdAt"].defaultValue === null &&
            this.columns["updatedAt"].defaultValue === null
          ) {
            stmt.update({
              createdAt: trx.raw("now()"),
              updatedAt: trx.raw("now()"),
            });
            await stmt;
          }
        } else if (mode === "update") {
          stmt.update({
            createdAt: trx.raw("now()"),
          });
          await stmt;
        }
      }

      if (table.afterUpdate)
        await table.afterUpdate.call(this, trx, context, mode, next, prev);
    },
  };
}
