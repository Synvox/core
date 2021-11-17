import { Knex } from "knex";
import { TableDef } from "../types";

/**
 * Updates created_at and updated_at timestamps on update and insert
 * Adds a ?since=timestamp query parameter
 * @example
 *     core.table(withTimestamps({ ... table config ... }))
 * @param table
 */
export default function withQuery<T>(
  searchColumns: string[],
  table: TableDef<T>
): TableDef<T> {
  return {
    ...table,
    queryModifiers: {
      async query(value: string, stmt) {
        ftsSearchModifier(
          stmt,
          searchColumns.map((v) => `${this.alias}.${v}`),
          value
        );
      },
      ...table.queryModifiers,
    },
  };
}

export function ftsSearchModifier(
  stmt: Knex.QueryBuilder,
  searchColumns: string[],
  value: string,
  not = false
) {
  const inner = searchColumns.map(() => `to_tsvector(??)`).join(" || ");

  const words = value.replace(/\s+/g, " ").split(" ");
  const tsQuery = words.map(() => `? || ':*'`).join(" || ' & ' || ");

  stmt.whereRaw(
    `${not ? "not " : ""}${inner} @@ to_tsquery('simple', ${tsQuery})`,
    [...searchColumns, ...words]
  );
}
