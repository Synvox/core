import { promises as fs } from 'fs';
import Knex, { QueryBuilder, Transaction } from 'knex';
import { Router } from 'express';
import { MixedSchema } from 'yup';
import { ContextFactory } from '.';
import { transformKey, caseMethods } from './knexHelpers';
import {
  classify,
  titleize,
  underscore,
  humanize,
  singularize,
} from 'inflection';
import { Mode } from 'Core';

export interface Table<T> {
  tableName: string;
  schemaName: string;
  tenantIdColumnName: string | undefined;
  init: (knex: Knex, schemaPath?: string | null) => Promise<void>;
  policy: (
    query: QueryBuilder,
    context: ReturnType<ContextFactory<T>>,
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
      context: ReturnType<ContextFactory<T>>
    ) => Promise<void>;
  };
  queryModifiers: {
    [name: string]: (
      value: any,
      query: QueryBuilder,
      context: ReturnType<ContextFactory<T>>
    ) => Promise<void>;
  };
  setters: {
    [key: string]: (
      trx: Transaction,
      value: any,
      row: any,
      context: ReturnType<ContextFactory<T>>
    ) => Promise<void>;
  };
  pluralForeignKeyMap: {
    [columnName: string]: string;
  };
  beforeHook?: (
    trx: Transaction,
    row: any,
    mode: 'insert' | 'update' | 'delete',
    context: ReturnType<ContextFactory<T>>
  ) => Promise<void>;
  afterHook?: (
    trx: Transaction,
    row: any,
    mode: 'insert' | 'update' | 'delete',
    context: ReturnType<ContextFactory<T>>
  ) => Promise<void>;
}

export type PartialTable<T> = { tableName: string } & Partial<Table<T>>;

export type TableEntry = {
  schemaName: string;
  tableName: string;
  tablePath: string;
  className: string;
  collectionName: string;
  name: string;
  columns: { [columnName: string]: Knex.ColumnInfo };
  uniqueColumns: Array<string[]>;
  relations: { [key: string]: string };
  queryModifiers: string[];
  pluralForeignKeyMap: { [key: string]: string };
};

export type Schema = {
  [path: string]: TableEntry;
};

let schema: Schema = {};

export async function loadSchema(filePath: string) {
  if (Object.keys(schema).length) return schema;
  const json = await fs.readFile(filePath, { encoding: 'utf8' });
  schema = JSON.parse(json);
  return schema;
}

export async function saveSchema(filePath: string) {
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

  await fs.writeFile(filePath, JSON.stringify(sort(schema), null, 2));
  schema = {}; // no longer needed
}

export default function buildTable<T>(table: PartialTable<T>): Table<T> {
  let initialized = false;

  return {
    schemaName: '',
    tenantIdColumnName: undefined,

    async init(knex: Knex, schemaPath: string | null = null) {
      this.schemaName = this.schemaName || 'public';

      const key = `${this.schemaName}.${this.tableName}`;
      if (initialized) return;
      initialized = true;

      if (schemaPath) {
        const loadedSchema = await loadSchema(schemaPath);
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
        schemaName: this.schemaName,
        tableName: this.tableName,
        tablePath: key,
        className,
        collectionName,
        name,
        columns: this.columns,
        uniqueColumns: this.uniqueColumns,
        relations: this.relations,
        queryModifiers: Object.keys(this.queryModifiers),
        pluralForeignKeyMap: this.pluralForeignKeyMap,
      };
    },

    async policy(
      _query: QueryBuilder,
      _context: ReturnType<ContextFactory<unknown>>,
      _mode: Mode
    ) {},

    get tablePath() {
      return [this.schemaName, this.tableName].filter(Boolean).join('.');
    },

    get path() {
      return (
        '/' +
        [this.schemaName === 'public' ? null : this.schemaName, this.tableName]
          .filter(Boolean)
          .join('/')
      );
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

function postgresTypesToJSONTsTypes(type: string) {
  /* istanbul ignore next */
  switch (type) {
    case 'bpchar':
    case 'char':
    case 'varchar':
    case 'text':
    case 'citext':
    case 'uuid':
    case 'bytea':
    case 'inet':
    case 'time':
    case 'timetz':
    case 'interval':
    case 'name':
    case 'character varying':
    case 'timestamp with time zone':
    case 'timestamp without time zone':
    case 'date':
    case 'timestamp':
    case 'timestamptz':
      return 'string';
    case 'int2':
    case 'int4':
    case 'int8':
    case 'float4':
    case 'float8':
    case 'numeric':
    case 'money':
    case 'oid':
    case 'bigint':
    case 'int':
      return 'number';
    case 'bool':
      return 'boolean';
    case 'json':
    case 'jsonb':
      return 'object';
    default:
      return 'any';
  }
}

export async function saveTsTypes(path: string) {
  const schemas: {
    [schemaName: string]: {
      [tableName: string]: TableEntry;
    };
  } = {};

  Object.values(schema).forEach((table: TableEntry) => {
    schemas[table.schemaName] = schemas[table.schemaName] || {};
    schemas[table.schemaName][table.tableName] =
      schemas[table.schemaName][table.tableName] || {};

    schemas[table.schemaName][table.tableName] = table;
  });

  let types = `
export type Collection<T> = {
  meta: {
    page: number;
    limit: number;
    hasMore: boolean;
    '@url': string;
    '@links': {
      count: string;
      ids: string;
      previousPage?: string;
      nextPage?: string;
    };
  };
  data: T[];
};`.trim();
  types += '\n\n';
  for (let schemaName in schemas) {
    types += `export namespace ${transformKey(
      schemaName,
      caseMethods.pascal
    )} {\n`;
    for (let tableName in schemas[schemaName]) {
      types += `  export type ${transformKey(
        singularize(tableName),
        caseMethods.pascal
      )} = {\n`;

      const table = schemas[schemaName][tableName];
      const { relations, columns } = table;

      const relationMaps = {
        hasOne: Object.entries(relations)
          .map(([column, tablePath]) => ({
            column,
            key: column.replace(/Id$/, ''),
            table: Object.values(schema).find(m => m.tablePath === tablePath)!,
          }))
          .filter(r => r.table),
        hasMany: Object.values(schema)
          .filter(m => m !== table)
          .map(otherTable => {
            return Object.entries(otherTable.relations)
              .filter(([_, tablePath]) => tablePath === table.tablePath)
              .map(([column]) => {
                return {
                  column,
                  key: table.pluralForeignKeyMap[column]
                    ? table.pluralForeignKeyMap[column]
                    : otherTable.tableName,
                  table: otherTable,
                };
              });
          })
          .reduce((a, b) => a.concat(b), [])
          .filter(r => r.table),
      };

      for (let columnName in columns) {
        const column = columns[columnName];
        let dataType = postgresTypesToJSONTsTypes(column.type);
        if (column.nullable) dataType += ' | null';
        types += `    ${columnName}: ${dataType};\n`;
      }

      types += `    '@url': string;\n`;
      types += `    '@links': {\n`;

      const { hasOne, hasMany } = relationMaps;

      for (let { column, key } of hasOne) {
        types += `      ${key}${columns[column].nullable ? '?' : ''}: string`;
        types += ';\n';
      }

      for (let { key } of hasMany) {
        types += `      ${key}: string;\n`;
      }

      types += `    };\n`;
      types += `  };\n`;
    }
    types += '}\n\n';
  }

  await fs.writeFile(path, types);
}
