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
    async afterUpdate(trx, context, mode, next, prev, schedule) {
      const stmt = trx(this.tablePath);
      if (next && (mode === "insert" || mode === "update")) {
        stmt.where(this.idColumnName, next[this.idColumnName]);

        if (this.tenantIdColumnName)
          stmt.where(this.tenantIdColumnName, next[this.tenantIdColumnName]);

        if (mode === "insert") {
          const patch = {};
          if (
            this.columns["createdAt"] &&
            this.columns["createdAt"].defaultValue === null
          ) {
            Object.assign(patch, {
              createdAt: trx.raw("now()"),
            });
          }

          if (
            this.columns["updatedAt"] &&
            this.columns["updatedAt"].defaultValue === null
          ) {
            Object.assign(patch, {
              updatedAt: trx.raw("now()"),
            });
          }

          if (Object.keys(patch).length) await stmt.update(patch);
        } else if (mode === "update" && this.columns["updatedAt"]) {
          await stmt.update({
            updatedAt: trx.raw("now()"),
          });
        }
      }

      if (table.afterUpdate)
        await table.afterUpdate.call(
          this,
          trx,
          context,
          mode,
          next,
          prev,
          schedule
        );
    },
  };
}
