import { Knex } from "knex";
import { EventEmitter } from "events";
import { promises as fs } from "fs";
import express, { Router, Request, Response } from "express";
import {
  ChangeSummary,
  ContextFactory,
  KnexGetter,
  ShouldEventBeSent,
  TableDef,
} from "./types";
import { Table, SavedTable } from "./Table";
import { wrap } from "./wrap";
import { qsStringify } from "./qsStringify";
import { saveTsTypes } from "./saveTsTypes";

export class Core<Context> {
  getContext: ContextFactory<Context>;
  getKnex: KnexGetter;
  eventEmitter: EventEmitter;
  schemaFilePath: string | null;
  loadSchemaFromFile: boolean;
  baseUrl: string;
  forwardQueryParams: string[];
  tables: Table<Context>[];
  initialized: boolean;
  initializationPromise?: Promise<void>;
  complexityLimit: number;
  eagerLoadingComplexityLimit: number;
  private _router?: Router;

  constructor(
    getKnex: KnexGetter | Knex,
    getContext: ContextFactory<Context>,
    options: {
      eventEmitter?: EventEmitter;
      schemaFilePath?: string | null;
      loadSchemaFromFile?: boolean;
      baseUrl?: string;
      forwardQueryParams?: string[];
      complexityLimit?: number;
      eagerLoadingComplexityLimit?: number;
    } = {}
  ) {
    // a real knex object has takes two parameters
    // ideally we could use instanceof Knex but knex
    // doesn't have a constructor.
    this.getKnex =
      ((getKnex as unknown) as any).length === 2
        ? async () => getKnex as Knex
        : getKnex;

    this.getContext = getContext;
    this.eventEmitter = options.eventEmitter ?? new EventEmitter();
    this.schemaFilePath = options.schemaFilePath ?? null;
    this.loadSchemaFromFile =
      options.loadSchemaFromFile ?? process.env.NODE_ENV === "production";
    this.baseUrl = options.baseUrl ?? "";
    this.forwardQueryParams = options.forwardQueryParams ?? [];
    this.tables = [];
    this.initialized = false;
    this.complexityLimit = options.complexityLimit ?? 100;
    this.eagerLoadingComplexityLimit = options.complexityLimit ?? 3;
  }

  table(tableDef: TableDef<Context>) {
    const table = new Table({
      baseUrl: this.baseUrl,
      forwardQueryParams: this.forwardQueryParams,
      eventEmitter: this.eventEmitter,
      complexityLimit: this.complexityLimit,
      eagerLoadingComplexityLimit: this.eagerLoadingComplexityLimit,
      ...tableDef,
    });

    this.tables.push(table);

    return table;
  }

  sse(shouldEventBeSent?: ShouldEventBeSent<Context, any>) {
    const emitter = this.eventEmitter;
    type ChangeEvent = { id: string; changes: ChangeSummary<any>[] };
    const sseHandlers = new Set<(changes: ChangeEvent) => void>();

    emitter.on("change", (changes: ChangeEvent) => {
      sseHandlers.forEach((handler) => handler(changes));
    });

    return wrap(async (req: Request, res: Response) => {
      const knex = await this.getKnex("read");

      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });

      res.write("\n");
      if (res.flush) res.flush();

      const context = this.getContext(req, res);

      const handler = async ({ id, changes }: ChangeEvent) => {
        const isVisible = async (change: ChangeSummary<any>) => {
          const table = this.tables.find((t) => `/${t.path}` === change.path);

          if (!table) return false;

          const stmt = knex(`${table.schemaName}.${table.tableName}`)
            .where(
              `${table.tableName}.${table.idColumnName}`,
              change.row[table.idColumnName]
            )
            .first();

          if (table.tenantIdColumnName) {
            stmt.where(
              `${table.tableName}.${table.tenantIdColumnName}`,
              change.row[table.tenantIdColumnName]
            );
          }

          await table.policy(stmt, context, "read", knex);

          return Boolean(await stmt);
        };

        const visibleChanges = (
          await Promise.all(
            changes.map(async (change) => {
              const shouldSend = shouldEventBeSent
                ? await shouldEventBeSent(
                    () => isVisible(change),
                    change,
                    context
                  )
                : await isVisible(change);
              return shouldSend ? change : null;
            })
          )
        ).filter(Boolean);

        if (visibleChanges.length === 0) return;

        const batch =
          [
            `id: ${id}`,
            "event: update",
            `data: ${JSON.stringify({
              changeId: id,
              changes: visibleChanges,
            })}`,
          ].join("\n") + "\n\n";

        res.write(batch);

        if (res.flush) res.flush();
      };

      const heartbeat = () => {
        res.write(":\n\n");
        if (res.flush) res.flush();
      };

      heartbeat();
      const interval = setInterval(heartbeat, 10000);

      const onEnd = () => {
        sseHandlers.delete(handler);
        clearInterval(interval);
      };

      sseHandlers.add(handler);
      req.on("end", onEnd);
      req.on("close", onEnd);
    });
  }

  async init() {
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

  get router() {
    if (this._router) return this._router;

    let routesAdded = false;
    const router = Router({ mergeParams: true });
    this._router = router;

    router.use(express.json());

    router.use(
      wrap(async (_req, _res, next) => {
        if (!routesAdded) {
          await this.init();
          addRoutes();
          routesAdded = true;
        }

        next();
      })
    );

    const addRoutes = () => {
      for (let table of this.tables) {
        router.use(`/${table.path}`, table.router);

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

            return count;
          })
        );

        for (let { name } of Object.values(table.relatedTables.hasMany)) {
          const nameCount = `${name}Count`;
          router.get(
            `/${table.path}/:${table.idColumnName}/${nameCount}`,
            wrap(async (req, res) => {
              const knex = await this.getKnex("read");
              const context = this.getContext(req, res);
              const row = await table.readOne(
                knex,
                {
                  ...req.params,
                  ...req.query,
                  include: [nameCount],
                },
                context
              );

              return row[nameCount];
            })
          );
        }

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

              return row[getterName];
            })
          );
        }

        router.get(
          `/${table.path}/first`,
          wrap(async (req, res) => {
            const knex = await this.getKnex("read");
            const context = this.getContext(req, res);
            return await table.readOne(
              knex,
              { ...req.params, ...req.query },
              context
            );
          })
        );

        router.get(
          `/${table.path}/:${table.idColumnName}`,
          wrap(async (req, res) => {
            const knex = await this.getKnex("read");
            const context = this.getContext(req, res);
            return await table.readOne(
              knex,
              { ...req.params, ...req.query },
              context
            );
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

        for (let [methodName, method] of Object.entries(table.methods)) {
          router.post(
            `/${table.path}/:${table.idColumnName}/${methodName}`,
            wrap(async (req, res) => {
              const knex = await this.getKnex("read");
              const context = this.getContext(req, res);
              const { include: _, ...query } = req.query;

              const row = await table.readOne(
                knex,
                {
                  ...req.params,
                  ...query,
                },
                context
              );

              const result = await method(row, req.body, context);
              return result;
            })
          );
        }

        for (let [methodName, method] of Object.entries(table.staticMethods)) {
          router.post(
            `/${table.path}/${methodName}`,
            wrap(async (req, res) => {
              const context = this.getContext(req, res);

              const result = await method(req.body, context);

              return result;
            })
          );
        }

        router.post(
          `/${table.path}`,
          wrap(async (req, res) => {
            const knex = await this.getKnex("write");
            const context = this.getContext(req, res);

            const body = Array.isArray(req.body)
              ? req.body.map((b) => ({ ...b, ...req.params, ...req.query }))
              : { ...req.body, ...req.params, ...req.query };

            return await table.write(knex, body, context);
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

        router.post(
          `/${table.path}/validate`,
          wrap(async (req, res) => {
            const knex = await this.getKnex("read");
            const context = this.getContext(req, res);
            const [_, errors = {}] = await table.validateDeep(
              knex,
              { ...req.body, ...req.params, ...req.query },
              context
            );

            return { errors };
          })
        );

        router.put(
          `/${table.path}/:${table.idColumnName}/validate`,
          wrap(async (req, res) => {
            const knex = await this.getKnex("read");
            const context = this.getContext(req, res);
            const [_, errors = {}] = await table.validateDeep(
              knex,
              { ...req.body, ...req.params, ...req.query },
              context
            );

            return { errors };
          })
        );

        router.put(
          `/${table.path}`,
          wrap(async (req, res) => {
            const knex = await this.getKnex("write");
            const context = this.getContext(req, res);
            return await table.writeAll(
              knex,
              { ...req.params, ...req.query },
              { ...req.body },
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

        for (let [name, { relation, table: relatedTable }] of Object.entries(
          table.relatedTables.hasMany
        )) {
          router.all(
            `/${table.path}/:${table.idColumnName}/${name}`,
            (req, res) => {
              const query = qsStringify({
                ...req.query,
                [relation.columnName]: req.params[table.idColumnName],
              });

              res.redirect(
                307,
                `${this.baseUrl}/${relatedTable.path}?${query}`
              );
            }
          );
        }

        for (let [name, { relation, table: relatedTable }] of Object.entries(
          table.relatedTables.hasOne
        )) {
          router.all(
            `/${table.path}/:${table.idColumnName}/${name}`,
            wrap(async (req, res) => {
              const knex = await this.getKnex("read");
              const context = this.getContext(req, res);

              const { [relation.columnName]: id } = await table.readOne(
                knex,
                { ...req.params, ...req.query },
                context
              );

              const query = qsStringify({
                ...req.query,
              });

              res.redirect(
                307,
                `${this.baseUrl}/${relatedTable.path}/${id}?${query}`
              );
            })
          );
        }
      }
    };

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
    {
      includeLinks = true,
      includeRelations = false,
      includeParams = false,
      includeKnex = false,
      useJsonTypes = true,
    }: {
      includeLinks?: boolean;
      includeRelations?: boolean;
      includeParams?: boolean;
      includeKnex?: boolean;
      useJsonTypes?: boolean;
    } = {}
  ) {
    await this.init();
    await saveTsTypes(this.tables, path, {
      includeLinks,
      includeRelations,
      includeParams,
      includeKnex,
      useJsonTypes,
    });
  }
}

export async function saveSchemaToFile(tables: Table<any>[], path: string) {
  const json = tables.reduce((acc, table) => {
    acc[table.tablePath] = {
      columns: table.columns,
      uniqueColumns: table.uniqueColumns,
      relations: table.relations,
      lookupTableIds: table.lookupTableIds,
    };
    return acc;
  }, {} as Record<string, SavedTable>);

  await fs.writeFile(path, JSON.stringify(deepSort(json), null, 2));
}

function deepSort(obj: any): any {
  if (typeof obj !== "object" || obj === null || obj instanceof Date)
    return obj;
  if (Array.isArray(obj)) return obj.map((item) => deepSort(item));

  return Object.fromEntries(
    Object.entries(obj)
      .sort((a, b) => String(a).localeCompare(String(b)))
      .map(([key, value]) => [key, deepSort(value)])
  );
}
