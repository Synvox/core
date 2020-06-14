import { promises as fs } from 'fs';
import path from 'path';
import pkgDir from 'pkg-dir';
import Knex, { QueryBuilder, Transaction } from 'knex';
import { Router } from 'express';
import { MixedSchema } from 'yup';
import { Context } from '.';
import { transformKey, caseMethods } from './knexHelpers';
import { classify, titleize, underscore, humanize } from 'inflection';
import { Mode } from 'Core';

export interface Table<T> {
  tableName: string;
  schemaName: string;
  tenantIdColumnName: string | undefined;
  init: (knex: Knex, fromSchemaFile?: boolean) => Promise<void>;
  policy: (
    query: QueryBuilder,
    context: ReturnType<Context<T>>,
    mode: Mode
  ) => Promise<void>;
  tablePath: string;
  path: string;
  columns: { [columnName: string]: Knex.ColumnInfo } | null;
  uniqueColumns: Array<string[]>;
  relations: { [key: string]: string };
  schema: { [columnName: string]: MixedSchema };
  paranoid: boolean;
  router: Router;
  idModifiers: {
    [name: string]: (
      query: QueryBuilder,
      context: ReturnType<Context<T>>
    ) => Promise<void>;
  };
  queryModifiers: {
    [name: string]: (
      value: any,
      query: QueryBuilder,
      context: ReturnType<Context<T>>
    ) => Promise<void>;
  };
  setters: {
    [key: string]: (
      trx: Transaction,
      value: any,
      row: any,
      context: ReturnType<Context<T>>
    ) => Promise<void>;
  };
  pluralForeignKeyMap: {
    [columnName: string]: string;
  };
  beforeHook?: (
    trx: Transaction,
    row: any,
    mode: 'insert' | 'update' | 'delete',
    context: ReturnType<Context<T>>
  ) => Promise<void>;
  afterHook?: (
    trx: Transaction,
    row: any,
    mode: 'insert' | 'update' | 'delete',
    context: ReturnType<Context<T>>
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

  function sort(object: any): any {
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

export default function buildTable<T>(table: Partial<Table<T>>): Table<T> {
  let initialized = false;

  return {
    tableName: '',
    schemaName: '',
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
        // columnInfo's type is only for a single column
        .columnInfo()) as unknown) as { [columnName: string]: Knex.ColumnInfo };

      if (table.paranoid && !('deletedAt' in this.columns))
        throw new Error(
          'Tried to make a paranoid table without a deletedAt column'
        );

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
        `
          .replace(/\s\s+/g, ' ')
          .trim(),
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
      _context: ReturnType<Context<unknown>>,
      _mode: Mode
    ) {},

    get tablePath() {
      return [this.schemaName, this.tableName].filter(Boolean).join('.');
    },

    get path() {
      return '/' + [this.schemaName, this.tableName].filter(Boolean).join('/');
    },

    get router() {
      return Router();
    },

    columns: null,
    uniqueColumns: [],
    relations: {},
    schema: {},
    paranoid: false,
    pluralForeignKeyMap: {},
    idModifiers: {},
    queryModifiers: {},
    setters: {},

    ...table,
  };
}
