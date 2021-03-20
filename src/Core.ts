import { EventEmitter } from "events";
import { promises as fs } from "fs";
import { ContextFactory, KnexGetter, TableDef } from "./types";
import { Table } from ".";
import express, { Router } from "express";
import { wrap } from "./wrap";
import { postgresTypesToJSONTsTypes } from "./lookups";
import { SavedTable } from "./Table";

export class Core<Context> {
  getContext: ContextFactory<Context>;
  getKnex: KnexGetter;
  emitter: EventEmitter;
  schemaFilePath: string | null;
  loadSchemaFromFile: boolean;
  baseUrl: string;
  forwardQueryParams: string[];
  tables: Table<Context>[];
  initialized: boolean;
  initializationPromise?: Promise<void>;

  constructor(
    getContext: ContextFactory<Context>,
    getKnex: KnexGetter,
    options: {
      emitter?: EventEmitter;
      schemaFilePath?: string | null;
      loadSchemaFromFile?: boolean;
      baseUrl?: string;
      forwardQueryParams?: string[];
    } = {}
  ) {
    this.getContext = getContext;
    this.getKnex = getKnex;
    this.emitter = new EventEmitter();
    this.schemaFilePath = options.schemaFilePath ?? null;
    this.loadSchemaFromFile =
      options.loadSchemaFromFile ?? process.env.NODE_ENV === "production";
    this.baseUrl = options.baseUrl ?? "/";
    this.forwardQueryParams = options.forwardQueryParams ?? [];
    this.tables = [];
    this.initialized = false;
  }

  table(tableDef: TableDef<Context>) {
    const table = new Table({
      baseUrl: this.baseUrl,
      forwardQueryParams: this.forwardQueryParams,
      ...tableDef,
    });

    this.tables.push(table);

    return table;
  }

  private async init() {
    if (this.initialized) return;
    if (this.initializationPromise) return this.initializationPromise;

    this.initializationPromise = (async () => {
      const knex = await this.getKnex("schema");
      const loadSchema = this.schemaFilePath && this.loadSchemaFromFile;

      const schema: Record<string, SavedTable> = loadSchema
        ? await this.loadFromFile(this.schemaFilePath!)
        : {};

      await Promise.all(
        this.tables.map(async (table) => {
          if (schema[table.tablePath])
            Object.assign(table, schema[table.tablePath]);
          else await table.init(knex);
        })
      );

      this.tables.forEach((table) => table.linkTables(this.tables));

      this.initialized = true;
      this.initializationPromise = undefined;

      if (this.schemaFilePath && !loadSchema)
        await this.saveSchemaToFile(this.schemaFilePath);
    })();

    await this.initializationPromise;
  }

  router() {
    const router = Router({ mergeParams: true });

    router.use(
      wrap(async (_req, _res, next) => {
        await this.init();
        next();
      })
    );

    router.use(express.json());

    for (let table of this.tables) {
      router.use(table.path, table.router);

      router.get(
        `/${table.path}/ids`,
        wrap(async (req, res) => {
          const knex = await this.getKnex("read");
          const context = this.getContext(req, res);
          return await table.ids(
            knex,
            { ...req.params, ...req.query },
            context
          );
        })
      );

      router.get(
        `/${table.path}/count`,
        wrap(async (req, res) => {
          const knex = await this.getKnex("read");
          const context = this.getContext(req, res);
          const count = await table.count(
            knex,
            { ...req.params, ...req.query },
            context
          );

          return {
            meta: {
              _url: `${table.baseUrl}${table.path}/count`,
            },
            data: count,
          };
        })
      );

      for (let getterName of [
        ...Object.keys(table.getters),
        ...Object.keys(table.eagerGetters),
      ]) {
        router.get(
          `/${table.path}/:${table.idColumnName}/${getterName}`,
          wrap(async (req, res) => {
            const knex = await this.getKnex("read");
            const context = this.getContext(req, res);
            const row = await table.readOne(
              knex,
              {
                ...req.params,
                ...req.query,
                include: [getterName],
              },
              context
            );

            return {
              meta: {
                _url: `${table.baseUrl}${table.path}/${
                  row[table.idColumnName]
                }/${getterName}`,
              },
              data: row[getterName],
            };
          })
        );
      }

      router.get(
        `/${table.path}/:${table.idColumnName}`,
        wrap(async (req, res) => {
          const knex = await this.getKnex("read");
          const context = this.getContext(req, res);
          return {
            data: await table.readOne(
              knex,
              { ...req.params, ...req.query },
              context
            ),
          };
        })
      );

      router.get(
        `/${table.path}`,
        wrap(async (req, res) => {
          const knex = await this.getKnex("read");
          const context = this.getContext(req, res);
          return await table.readMany(
            knex,
            { ...req.params, ...req.query },
            context
          );
        })
      );

      router.post(
        `/${table.path}`,
        wrap(async (req, res) => {
          const knex = await this.getKnex("write");
          const context = this.getContext(req, res);
          return await table.write(
            knex,
            { ...req.params, ...req.query },
            context
          );
        })
      );

      router.put(
        `/${table.path}/:${table.idColumnName}`,
        wrap(async (req, res) => {
          const knex = await this.getKnex("write");
          const context = this.getContext(req, res);
          return await table.write(
            knex,
            { ...req.body, ...req.params, ...req.query },
            context
          );
        })
      );

      router.delete(
        `/${table.path}/:${table.idColumnName}`,
        wrap(async (req, res) => {
          const knex = await this.getKnex("write");
          const context = this.getContext(req, res);
          return await table.write(
            knex,
            {
              ...req.body,
              ...req.params,
              ...req.query,
              _delete: true,
            },
            context
          );
        })
      );
    }

    return router;
  }

  async saveSchemaToFile(path: string) {
    await saveSchemaToFile(this.tables, path);
  }

  async loadFromFile(path: string) {
    const json = await fs.readFile(path, { encoding: "utf8" });
    return JSON.parse(json);
  }

  async saveTsTypes(
    path: string,
    includeLinks = true,
    includeRelations = false
  ) {
    await this.init();
    await saveTsTypes(this.tables, path, includeLinks, includeRelations);
  }
}

export async function saveSchemaToFile(tables: Table<any>[], path: string) {
  tables = tables.sort((a, b) => a.tablePath.localeCompare(b.tablePath));

  const json = tables.reduce((acc, table) => {
    acc[table.tablePath] = {
      columns: table.columns,
      uniqueColumns: table.uniqueColumns,
      relations: table.relations,
    };
    return acc;
  }, {} as Record<string, SavedTable>);

  await fs.writeFile(path, JSON.stringify(json, null, 2));
}

export async function saveTsTypes(
  tables: Table<any>[],
  path: string,
  includeLinks: boolean,
  includeRelations: boolean
) {
  tables = tables.sort((a, b) => a.tablePath.localeCompare(b.tablePath));

  let types = "";
  for (let table of tables) {
    types += `export type ${table.className} = {\n`;
    const { columns } = table;

    for (let columnName in columns) {
      const column = columns[columnName];
      let type = column.type;
      let array = false;
      if (type.endsWith("[]")) {
        type = type.slice(0, -2);
        array = true;
      }

      let dataType = postgresTypesToJSONTsTypes(type);
      if (array) dataType += "[]";

      if (column.nullable) dataType += " | null";
      types += `  ${columnName}: ${dataType};\n`;
    }

    if (includeLinks) {
      types += `  '_url': string;\n`;
      types += `  '_type': string;\n`;
      types += `  '_links': {\n`;

      const { hasOne, hasMany } = table.relatedTables;

      for (let [
        key,
        {
          relation: { columnName: column },
        },
      ] of Object.entries(hasOne)) {
        types += `    ${key}${columns[column].nullable ? "?" : ""}: string`;
        types += ";\n";
      }

      for (let key of Object.keys(hasMany)) {
        types += `    ${key}: string;\n`;
      }

      types += `  };\n`;
    }

    if (includeRelations) {
      const { hasOne, hasMany } = table.relatedTables;

      for (let [
        key,
        {
          relation: { columnName: column },
          table,
        },
      ] of Object.entries(hasOne)) {
        types += `  ${key}${columns[column].nullable ? "?" : ""}: ${
          table.className
        }`;
        types += ";\n";
      }

      for (let [key, { table }] of Object.entries(hasMany)) {
        types += `  ${key}: ${table.className}[];\n`;
      }
    }

    types += `};\n\n`;
  }

  await fs.writeFile(path, types.trim() + "\n");
}
