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
    with refs as (
    select
      pg_class.oid as oid,
      ref_class.oid as ref_oid,
      pg_constraint.oid as con_oid,
      pg_namespace.nspname as schema_name,
      pg_class.relname as table_name,
      ref_namespace.nspname as references_schema,
      ref_class.relname as references_table,
      confupdtype as update_rule,
      confdeltype as delete_rule,
      unnest(conkey) as column_index,
      unnest(confkey) as ref_column_index
    from pg_constraint
    join pg_class on pg_class.oid = pg_constraint.conrelid
    join pg_namespace on pg_namespace.oid = pg_class.relnamespace
    join pg_class ref_class on pg_constraint.confrelid = ref_class.oid
    join pg_namespace ref_namespace on ref_namespace.oid = ref_class.relnamespace
    where pg_namespace.nspname = ?
    and pg_class.relname = ?
    and pg_constraint.contype = 'f'
    )
    select
      refs.schema_name,
      refs.table_name,
      refs.references_schema,
      refs.references_table,
      case
        when update_rule = 'a' then 'NO ACTION'
        when update_rule = 'r' then 'RESTRICT'
        when update_rule = 'c' then 'CASCADE'
        when update_rule = 'n' then 'SET NULL'
        when update_rule = 'd' then 'SET DEFAULT'
        else ''
      end	as update_rule,
      case
        when delete_rule = 'a' then 'NO ACTION'
        when delete_rule = 'r' then 'RESTRICT'
        when delete_rule = 'c' then 'CASCADE'
        when delete_rule = 'n' then 'SET NULL'
        when delete_rule = 'd' then 'SET DEFAULT'
        else ''
      end	as delete_rule,
      (array_agg(pg_attribute1.attname))[1] as column_name,
      (array_agg(pg_attribute2.attname))[1] as references_column_name
    from refs
    join pg_attribute pg_attribute1 on pg_attribute1.attrelid = refs.oid and pg_attribute1.attnum = column_index
    join pg_attribute pg_attribute2 on pg_attribute2.attrelid = refs.ref_oid and pg_attribute2.attnum = ref_column_index
    where pg_attribute1.attname <> pg_attribute2.attname
    and pg_attribute1.attname <> 'id'
    and pg_attribute2.attname = 'id'
    group by
      refs.con_oid,
      refs.schema_name,
      refs.table_name,
      refs.references_schema,
      refs.references_table,
      update_rule,
      delete_rule
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
