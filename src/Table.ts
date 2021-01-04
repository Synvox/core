import { promises as fs } from 'fs';
import Knex, { QueryBuilder, Transaction } from 'knex';
import { Router } from 'express';
import { BaseSchema } from 'yup';
import { ContextFactory, Mode } from '.';
import { transformKey, caseMethods } from './knexHelpers';
import { classify, titleize, underscore, humanize } from 'inflection';
import { postgresTypesToJSONTsTypes } from './lookups';

export type PartialTable<T> = { tableName: string } & Partial<{
  schemaName: string;
  tenantIdColumnName: string | null;
  policy: (
    this: Table<T>,
    query: QueryBuilder,
    context: ReturnType<ContextFactory<T>>,
    mode: Mode
  ) => Promise<void>;
  schema: { [columnName: string]: BaseSchema };
  path: string;
  readOnlyColumns: string[];
  hiddenColumns: string[];
  paranoid: boolean;
  allowUpserts: boolean;
  router: Router;
  idModifiers: {
    [name: string]: (
      this: Table<T>,
      query: QueryBuilder,
      context: ReturnType<ContextFactory<T>>
    ) => Promise<void>;
  };
  queryModifiers: {
    [name: string]: (
      this: Table<T>,
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
  eagerGetters: {
    [key: string]: (
      this: Table<T>,
      stmt: QueryBuilder,
      context: ReturnType<ContextFactory<T>>
    ) => Promise<void>;
  };
  getters: {
    [key: string]: (
      row: any,
      context: ReturnType<ContextFactory<T>>
    ) => Promise<any>;
  };
  methods: {
    [key: string]: (
      row: any,
      context: ReturnType<ContextFactory<T>>,
      body: any
    ) => Promise<any>;
  };
  pluralForeignKeyMap: {
    [columnName: string]: string;
  };
  beforeUpdate: (
    this: Table<T>,
    trx: Transaction,
    context: ReturnType<ContextFactory<T>>,
    mode: 'insert' | 'update' | 'delete',
    draft: any,
    current: any
  ) => Promise<void>;
  afterUpdate: (
    this: Table<T>,
    trx: Transaction,
    context: ReturnType<ContextFactory<T>>,
    mode: 'insert' | 'update' | 'delete',
    next: any,
    previous: any
  ) => Promise<void>;
}>;

export type Table<T> = Required<PartialTable<T>> & {
  columns: Columns | null;
  tablePath: string;
  uniqueColumns: Array<string[]>;
  relations: {
    [key: string]: {
      path: string;
      columnName: string;
      referencesSchema: string;
      referencesTable: string;
      referencesColumnName: string;
      deleteRule: string;
      updateRule: string;
    };
  };
  schema: { [columnName: string]: BaseSchema };
  alias: string;
};

export type TableEntry = {
  schemaName: string;
  tableName: string;
  tablePath: string;
  className: string;
  collectionName: string;
  name: string;
  columns: Columns;
  uniqueColumns: Array<string[]>;
  relations: {
    [key: string]: {
      path: string;
      columnName: string;
      referencesSchema: string;
      referencesTable: string;
      referencesColumnName: string;
      deleteRule: string;
      updateRule: string;
    };
  };
  queryModifiers: string[];
  pluralForeignKeyMap: { [key: string]: string };
};

export type Schema = {
  [path: string]: TableEntry;
};

function sortObject(object: any): any {
  if (typeof object !== 'object') return object;

  if (Array.isArray(object)) return object.map(sortObject);

  const ordered: any = {};
  Object.keys(object)
    .sort()
    .forEach(function(key) {
      ordered[key] = object[key];
    });

  return ordered;
}

let schema: Schema = {};

export async function loadSchema(filePath: string) {
  if (Object.keys(schema).length) return schema;
  const json = await fs.readFile(filePath, { encoding: 'utf8' });
  schema = JSON.parse(json);
  return schema;
}

export async function saveSchema(filePath: string) {
  await fs.writeFile(filePath, JSON.stringify(sortObject(schema), null, 2));
  schema = {}; // no longer needed
}

type Column = {
  name: string;
  type: string;
  nullable: boolean;
  defaultValue: string | null;
};
type Columns = { [name: string]: Column };

async function columnInfo(knex: Knex, schemaName: string, tableName: string) {
  const stmt = knex.raw(
    `
      select
        a.attname as "name",
        pg_catalog.format_type(a.atttypid, a.atttypmod) as "type",
        not a.attnotnull as "nullable",
        pg_get_expr(d.adbin, d.adrelid) as "default_value"
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
      .replace(/\s\s+/g, ' ')
      .trim(),
    [
      transformKey(schemaName, caseMethods.snake),
      transformKey(tableName, caseMethods.snake),
    ]
  );

  const {
    rows: columns,
  }: {
    rows: Column[];
  } = await stmt;

  const formatted = columns
    .map(column => ({
      ...column,
      name: transformKey(column.name, caseMethods.camel),
      type: column.type.startsWith('character varying')
        ? 'character varying'
        : column.type,
    }))
    .reduce(
      (acc: Columns, column) => Object.assign(acc, { [column.name]: column }),
      {} as Columns
    );

  return formatted;
}

export async function initTable<Context>(
  table: Table<Context>,
  knex: Knex,
  writeSchemaToFile: string | null = null
) {
  table.schemaName = table.schemaName || 'public';

  const key = `${table.schemaName}.${table.tableName}`;

  if (writeSchemaToFile) {
    const loadedSchema = await loadSchema(writeSchemaToFile);
    if (loadedSchema[key]) {
      const { columns, uniqueColumns, relations } = loadedSchema[key];

      table.columns = columns;
      table.uniqueColumns = uniqueColumns;
      table.relations = relations;

      return;
    }
  }

  table.columns = await columnInfo(knex, table.schemaName, table.tableName);

  if (table.paranoid && !('deletedAt' in table.columns))
    throw new Error(
      'Tried to make a paranoid table without a deletedAt column'
    );

  const uniqueConstraints = await knex('pg_catalog.pg_constraint as con')
    .join('pg_catalog.pg_class as rel', 'rel.oid', 'con.conrelid')
    .join('pg_catalog.pg_namespace as nsp', 'nsp.oid', 'connamespace')
    .where('nsp.nspname', transformKey(table.schemaName, caseMethods.snake))
    .where('rel.relname', transformKey(table.tableName, caseMethods.snake))
    .where('con.contype', 'u')
    .select('con.conkey as indexes')
    .then(rows => rows.map(r => r.indexes as number[]));

  table.uniqueColumns = uniqueConstraints.map(indexes =>
    indexes.map(
      (index: number) =>
        Object.keys(table.columns!)[
          index - 1
          // table is 1 indexed in postgres
        ]
    )
  );

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
      .replace(/\s\s+/g, ' ')
      .trim(),
    [
      transformKey(table.schemaName, caseMethods.snake),
      transformKey(table.tableName, caseMethods.snake),
    ]
  );

  const camelize = (str: string) => transformKey(str, caseMethods.camel);

  table.relations = Object.fromEntries(
    refs.map(
      (ref: {
        columnName: string;
        referencesSchema: string;
        referencesTable: string;
        referencesColumnName: string;
        deleteRule: string;
        updateRule: string;
      }) => [
        camelize(ref.columnName),
        {
          path: `${camelize(ref.referencesSchema)}.${camelize(
            ref.referencesTable
          )}`,
          referencesSchema: ref.referencesSchema,
          referencesTable: ref.referencesTable,
          referencesColumnName: ref.referencesColumnName,
          deleteRule: ref.deleteRule,
          updateRule: ref.updateRule,
        },
      ]
    )
  );

  const className = classify(table.tableName);
  const collectionName = humanize(underscore(table.tableName, true), true);
  const name = titleize(underscore(className));

  schema[key] = {
    schemaName: table.schemaName,
    tableName: table.tableName,
    tablePath: key,
    className,
    collectionName,
    name,
    columns: table.columns,
    uniqueColumns: table.uniqueColumns,
    relations: table.relations,
    queryModifiers: Object.keys(table.queryModifiers),
    pluralForeignKeyMap: table.pluralForeignKeyMap,
  };
}

export default function buildTable<T>(table: PartialTable<T>): Table<T> {
  return {
    alias: table.tableName,
    schemaName: '',
    tenantIdColumnName: null,

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

    router: Router(),

    columns: null,
    uniqueColumns: [],
    relations: {},
    schema: {},
    paranoid: false,
    allowUpserts: false,
    pluralForeignKeyMap: {},
    idModifiers: {},
    queryModifiers: {},
    setters: {},
    getters: {},
    eagerGetters: {},
    methods: {},
    readOnlyColumns: [],
    hiddenColumns: [],

    async beforeUpdate() {},
    async afterUpdate() {},

    ...table,
  };
}

export async function saveTsTypes(
  path: string,
  includeLinks = true,
  includeRelations = false
) {
  const sortedSchema = sortObject(schema) as Schema;

  let schemas: {
    [schemaName: string]: {
      [tableName: string]: TableEntry;
    };
  } = {};

  Object.values(sortedSchema).forEach((table: TableEntry) => {
    schemas[table.schemaName] = schemas[table.schemaName] || {};
    schemas[table.schemaName][table.tableName] =
      schemas[table.schemaName][table.tableName] || {};

    schemas[table.schemaName][table.tableName] = table;
  });

  let types = '';
  for (let schemaName in schemas) {
    for (let tableName in schemas[schemaName]) {
      const table = schemas[schemaName][tableName];
      types += `export type ${table.className} = {\n`;
      const { relations, columns } = table;

      const thisSchema = schema;

      const relationMaps = {
        hasOne: Object.entries(relations)
          .map(([column, { path: tablePath }]) => ({
            column,
            key: column.replace(/Id$/, ''),
            table: Object.values(thisSchema).find(
              m => m.tablePath === tablePath
            )!,
          }))
          .filter(r => r.table),
        hasMany: Object.values(thisSchema)
          .filter(m => m !== table)
          .map(otherTable => {
            return Object.entries(otherTable.relations)
              .filter(
                ([_, { path: tablePath }]) => tablePath === table.tablePath
              )
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
        let type = column.type;
        let array = false;
        if (type.endsWith('[]')) {
          type = type.slice(0, -2);
          array = true;
        }

        let dataType = postgresTypesToJSONTsTypes(type);
        if (array) dataType += '[]';

        if (column.nullable) dataType += ' | null';
        types += `  ${columnName}: ${dataType};\n`;
      }

      if (includeLinks) {
        types += `  '@url': string;\n`;
        types += `  '@links': {\n`;

        const { hasOne, hasMany } = relationMaps;

        for (let { column, key } of hasOne) {
          types += `    ${key}${columns[column].nullable ? '?' : ''}: string`;
          types += ';\n';
        }

        for (let { key } of hasMany) {
          types += `    ${key}: string;\n`;
        }

        types += `  };\n`;
      }
      if (includeRelations) {
        const { hasOne, hasMany } = relationMaps;

        for (let { column, key, table: refTable } of hasOne) {
          types += `  ${key}${columns[column].nullable ? '?' : ''}: ${
            refTable.className
          }`;
          types += ';\n';
        }

        for (let { key, table: refTable } of hasMany) {
          types += `  ${key}: ${refTable.className}[];\n`;
        }
      }
      types += `};\n\n`;
    }
  }

  await fs.writeFile(path, types);
}
