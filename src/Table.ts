import { promises as fs } from 'fs';
import path from 'path';
import pkgDir from 'pkg-dir';
import Knex, { QueryBuilder, Transaction } from 'knex';
import { Router } from 'express';
import { MixedSchema } from 'yup';
import { Authorizer } from '.';
import { transformKey, caseMethods } from './knexHelpers';
import { classify, titleize, underscore, humanize } from 'inflection';

export interface TableConfig {
  tableName: string;
  schemaName: string;
  userIdColumnName: string | undefined;
  tenantIdColumnName: string | undefined;
  init: (knex: Knex, fromSchemaFile?: boolean) => Promise<void>;
  policy: (
    query: QueryBuilder,
    authorizer: ReturnType<Authorizer>,
    mode: 'insert' | 'read' | 'update' | 'delete'
  ) => Promise<void>;
  tablePath: string;
  path: string;
  columns: { [columnName: string]: Knex.ColumnInfo } | null;
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
  setters: {
    [key: string]: (
      trx: Transaction,
      value: any,
      row: any,
      authorizer: ReturnType<Authorizer>
    ) => Promise<void>;
  };
  pluralForeignKeyMap: {
    [columnName: string]: string;
  };
  afterHook?: (
    trx: Transaction,
    row: any,
    mode: 'insert' | 'update' | 'delete',
    authorizer: ReturnType<Authorizer>
  ) => Promise<void>;
}

let schema: {
  [key: string]: {
    className: string;
    collectionName: string;
    name: string;
    columns: { [columnName: string]: Knex.ColumnInfo };
    uniqueColumns: Array<string[]>;
    relations: { [key: string]: string };
    queryModifiers: string[];
  };
} = {};

export async function loadSchema() {
  const schemaPath = path.join((await pkgDir(__dirname))!, '../schema.json');
  if (Object.keys(schema).length) return schema;
  const json = await fs.readFile(schemaPath, { encoding: 'utf8' });
  schema = JSON.parse(json);
  return schema;
}

export async function saveSchema() {
  const schemaPath = path.join((await pkgDir(__dirname))!, '../schema.json');

  function sort<T extends any>(object: T): T {
    if (typeof object !== 'object') return object;

    if (Array.isArray(object)) return object.map(sort);

    const ordered: any = {};
    Object.keys(object)
      .sort()
      .forEach(function(key) {
        ordered[key] = object[key];
      });

    return ordered;
  }

  await fs.writeFile(schemaPath, JSON.stringify(sort(schema), null, 2));
  schema = {}; // no longer needed
}

export default function Table(table: Partial<TableConfig>): TableConfig {
  let initialized = false;
  return {
    tableName: '',
    schemaName: '',
    userIdColumnName: undefined,
    tenantIdColumnName: undefined,

    async init(knex: Knex, fromSchemaFile: boolean = false) {
      const key = `${this.schemaName}.${this.tableName}`;
      if (initialized) return;
      initialized = true;

      if (fromSchemaFile) {
        const loadedSchema = await loadSchema();
        if (loadedSchema[key]) {
          const { columns, uniqueColumns, relations } = loadedSchema[key];

          this.columns = columns;
          this.uniqueColumns = uniqueColumns;
          this.relations = relations;

          return;
        }
      }

      this.columns = ((await knex(this.tableName)
        .withSchema(this.schemaName)
        // pretty sure this is a bug in knex.
        //columnInfo's type is only for a single column
        .columnInfo()) as unknown) as { [columnName: string]: Knex.ColumnInfo };

      const uniqueConstraints = await knex('pg_catalog.pg_constraint con')
        .join('pg_catalog.pg_class rel', 'rel.oid', 'con.conrelid')
        .join('pg_catalog.pg_namespace nsp', 'nsp.oid', 'connamespace')
        .where('nsp.nspname', this.schemaName)
        .where('rel.relname', this.tableName)
        .where('con.contype', 'u')
        .select('con.conkey as indexes')
        .then(rows => rows.map(r => r.indexes as number[]));

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

      const className = classify(this.tableName);
      const collectionName = humanize(underscore(this.tableName, true), true);
      const name = titleize(underscore(className));

      schema[key] = {
        className,
        collectionName,
        name,
        columns: this.columns,
        uniqueColumns: this.uniqueColumns,
        relations: this.relations,
        queryModifiers: Object.keys(this.queryModifiers),
      };
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
    pluralForeignKeyMap: {},

    get router() {
      return Router();
    },
    idModifiers: {},
    queryModifiers: {},
    setters: {},

    ...table,
  };
}
