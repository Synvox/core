import { Knex } from "knex";
import { Column, Columns, Relation, Relations } from "./types";
import { toSnakeCase, toCamelCase } from "./case";

export async function getColumnInfo(
  knex: Knex,
  schemaName: string,
  tableName: string
) {
  const stmt = knex.raw(
    `
      select
        a.attname as "name",
        pg_catalog.format_type(a.atttypid, a.atttypmod) as "type",
        not a.attnotnull as "nullable",
        pg_get_expr(d.adbin, d.adrelid) as "default_value",
        greatest(atttypmod - 4, -1) as length
      from pg_catalog.pg_attribute a
      left join pg_attrdef d on a.attnum = d.adnum and d.adrelid = a.attrelid
      where a.attnum > 0
        and not a.attisdropped
        and a.attrelid =
          (select c.oid
          from pg_catalog.pg_class c
          left join pg_catalog.pg_namespace n on n.oid = c.relnamespace
          where n.nspname = ?
            and c.relname = ?)
      order by a.attnum;`
      .replace(/\s\s+/g, " ")
      .trim(),
    [toSnakeCase(schemaName), toSnakeCase(tableName)]
  );

  const {
    rows: columns,
  }: {
    rows: Column[];
  } = await stmt;

  const formatted: Columns = columns
    .map((column) => ({
      ...column,
      name: toCamelCase(column.name),
      type: column.type.startsWith("character varying")
        ? "character varying"
        : column.type.startsWith("numeric")
        ? "numeric"
        : column.type,
    }))
    .reduce(
      (acc: Columns, column) => Object.assign(acc, { [column.name]: column }),
      {} as Columns
    );

  return formatted;
}
export async function getUniqueColumns(
  knex: Knex,
  schemaName: string,
  tableName: string
) {
  const { rows } = await knex.raw(
    `
      select json_agg(a.attname) as indexes
      from pg_catalog.pg_constraint as con
      join pg_catalog.pg_class as rel on rel.oid=con.conrelid
      join pg_catalog.pg_namespace as nsp on nsp.oid=connamespace
      cross join lateral unnest(con.conkey) ak(k)
      inner join pg_attribute a
        on a.attrelid = con.conrelid
        and a.attnum = ak.k
      where con.contype = 'u'
      and nsp.nspname=?
      and rel.relname=?
      group by con.conkey
  `,
    [toSnakeCase(schemaName), toSnakeCase(tableName)]
  );

  return rows.map(({ indexes }: { indexes: string[] }) =>
    indexes.map((x) => toCamelCase(x))
  );
}
export async function getRelations(
  knex: Knex,
  schemaName: string,
  tableName: string
) {
  const { rows: refs } = await knex.raw(
    `
      select
        kcu.table_schema,
        kcu.table_name,
        kcu.column_name as column_name,
        rel_kcu.table_schema as references_schema,
        rel_kcu.table_name as references_table,
        rel_kcu.column_name as references_column_name,
        rco.update_rule,
        rco.delete_rule
      from information_schema.table_constraints tco
      join information_schema.key_column_usage kcu
        on tco.constraint_schema = kcu.constraint_schema
        and tco.constraint_name = kcu.constraint_name
      join information_schema.referential_constraints rco
        on tco.constraint_schema = rco.constraint_schema
        and tco.constraint_name = rco.constraint_name
      join information_schema.key_column_usage rel_kcu
        on rco.unique_constraint_schema = rel_kcu.constraint_schema
        and rco.unique_constraint_name = rel_kcu.constraint_name
        and kcu.ordinal_position = rel_kcu.ordinal_position
      where tco.constraint_type = 'FOREIGN KEY'
        and rel_kcu.table_name is not null
        and rel_kcu.column_name = 'id'
      and kcu.table_schema = ?
      and kcu.table_name = ?
    `
      .replace(/\s\s+/g, " ")
      .trim(),
    [toSnakeCase(schemaName), toSnakeCase(tableName)]
  );

  const relations = Object.fromEntries(
    refs.map(
      (ref: {
        columnName: string;
        referencesSchema: string;
        referencesTable: string;
        referencesColumnName: string;
        deleteRule: string;
        updateRule: string;
      }) => [
        toCamelCase(ref.columnName),
        new Relation({
          tableName,
          schemaName,
          columnName: toCamelCase(ref.columnName),
          referencesSchema: toCamelCase(ref.referencesSchema),
          referencesTable: toCamelCase(ref.referencesTable),
          referencesColumnName: toCamelCase(ref.referencesColumnName),
          deleteRule: ref.deleteRule,
          updateRule: ref.updateRule,
        }),
      ]
    )
  );

  return relations as Relations;
}
