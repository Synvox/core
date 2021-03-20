import { EventEmitter } from "events";
import { ContextFactory, KnexGetter, TableDef } from "./types";
import { Table } from ".";
import express, { Router } from "express";
import { wrap } from "./wrap";

export class Core<Context> {
  getContext: ContextFactory<Context>;
  getKnex: KnexGetter;
  emitter: EventEmitter;
  writeSchemaToFile: string | null;
  writeTypesToFile: string | null;
  includeLinksWithTypes: boolean;
  includeRelationsWithTypes: boolean;
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
      writeSchemaToFile?: string | null;
      writeTypesToFile?: string | null;
      includeLinksWithTypes?: boolean;
      includeRelationsWithTypes?: boolean;
      loadSchemaFromFile?: boolean;
      baseUrl?: string;
      forwardQueryParams?: string[];
    } = {}
  ) {
    this.getContext = getContext;
    this.getKnex = getKnex;
    this.emitter = new EventEmitter();
    this.writeSchemaToFile = options.writeSchemaToFile ?? null;
    this.writeTypesToFile = options.writeTypesToFile ?? null;
    this.includeLinksWithTypes = options.includeLinksWithTypes ?? false;
    this.includeRelationsWithTypes = options.includeRelationsWithTypes ?? false;
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

      await Promise.all(this.tables.map((table) => table.init(knex)));

      this.tables.forEach((table) => table.linkTables(this.tables));

      this.initialized = true;
      this.initializationPromise = undefined;
    })();

    await this.initializationPromise;
  }

  router() {
    const router = Router();

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
            { ...req.query, ...req.params },
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
            { ...req.query, ...req.params },
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
            const row = await table.read(
              knex,
              { ...req.query, ...req.params, include: [getterName] },
              context,
              false
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
            data: await table.read(
              knex,
              { ...req.query, ...req.params },
              context,
              false
            ),
          };
        })
      );

      router.get(
        `/${table.path}`,
        wrap(async (req, res) => {
          const knex = await this.getKnex("read");
          const context = this.getContext(req, res);
          return await table.read(knex, req.query, context);
        })
      );

      router.post(
        `/${table.path}`,
        wrap(async (req, res) => {
          const knex = await this.getKnex("write");
          const context = this.getContext(req, res);
          return await table.write(knex, req.body, context);
        })
      );

      router.put(
        `/${table.path}/:${table.idColumnName}`,
        wrap(async (req, res) => {
          const knex = await this.getKnex("write");
          const context = this.getContext(req, res);
          return await table.write(
            knex,
            { ...req.body, ...req.params },
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
            { ...req.body, ...req.params, _delete: true },
            context
          );
        })
      );
    }

    return router;
  }
}
