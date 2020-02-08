import Knex, { QueryBuilder } from 'knex';
import { Router } from 'express';
import { MixedSchema } from 'yup';
import { Authorizer } from '.';
import { transformKey, caseMethods } from './knexHelpers';

export interface TableConfig {
  tableName: string;
  schemaName: string;
  userIdColumnName: string | undefined;
  tenantIdColumnName: string | undefined;
  init: (knex: Knex) => Promise<void>;
  policy: (
    query: QueryBuilder,
    authorizer: ReturnType<Authorizer>,
    mode: 'insert' | 'read' | 'update' | 'delete'
  ) => Promise<void>;
  tablePath: string;
  path: string;
  columns: Knex.ColumnInfo | null;
  uniqueColumns: Array<string[]>;
  relations: { [key: string]: string };
  schema: { [columnName: string]: MixedSchema };
  router: Router;
  idModifiers: {
    [name: string]: (
      query: QueryBuilder,
      authorizer: ReturnType<Authorizer>
    ) => Promise<void>;
  };
  queryModifiers: {
    [name: string]: (
      value: any,
      query: QueryBuilder,
      authorizer: ReturnType<Authorizer>
    ) => Promise<void>;
  };
}

export default function Table(table: Partial<TableConfig>): TableConfig {
  let initialized = false;
  return {
    tableName: '',
    schemaName: '',
    userIdColumnName: undefined,
    tenantIdColumnName: undefined,

    async init(knex: Knex) {
      if (initialized) return;
      initialized = true;

      this.columns = await knex(this.tableName)
        .withSchema(this.schemaName)
        .columnInfo();

      const uniqueConstraints = await knex('pg_catalog.pg_constraint con')
        .join('pg_catalog.pg_class rel', 'rel.oid', 'con.conrelid')
        .join('pg_catalog.pg_namespace nsp', 'nsp.oid', 'connamespace')
        .where('nsp.nspname', this.schemaName)
        .where('rel.relname', this.tableName)
        .where('con.contype', 'u')
        .select('con.conkey as indexes')
        .then(rows => rows.map(r => r.indexes));

      this.uniqueColumns = uniqueConstraints.map(indexes =>
        indexes.map(
          (index: number) =>
            Object.keys(this.columns!)[
              index - 1
              // this is 1 indexed in postgres
            ]
        )
      );

      const { rows: refs } = await knex.raw(
        `
          select
            kcu.column_name as column_name,
            rel_kcu.table_schema as references_schema,
            rel_kcu.table_name as references_table
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
        `,
        [
          transformKey(this.schemaName, caseMethods.snake),
          transformKey(this.tableName, caseMethods.snake),
        ]
      );

      const camelize = (str: string) => transformKey(str, caseMethods.camel);

      this.relations = Object.fromEntries(
        refs.map(
          (ref: {
            columnName: string;
            referencesSchema: string;
            referencesTable: string;
          }) => [
            camelize(ref.columnName),
            `${camelize(ref.referencesSchema)}.${camelize(
              ref.referencesTable
            )}`,
          ]
        )
      );

      if (this.tableName === 'columnEnumValues')
        console.log(this.tableName, refs, this.relations);
    },

    async policy(
      _query: QueryBuilder,
      _authorizer: ReturnType<Authorizer>,
      _mode: 'insert' | 'read' | 'update' | 'delete'
    ) {},

    get tablePath() {
      return [this.schemaName, this.tableName].filter(Boolean).join('.');
    },

    get path() {
      return '/' + [this.schemaName, this.tableName].filter(Boolean).join('/');
    },

    columns: null,
    uniqueColumns: [],
    relations: {},
    schema: {},

    get router() {
      return Router();
    },
    idModifiers: {},
    queryModifiers: {},

    ...table,
  };
}
