import { EventEmitter } from 'events';
import qs from 'qs';
import Knex, { Transaction, QueryBuilder } from 'knex';
import express, { Request, Response, NextFunction, Express } from 'express';
import setValue from 'set-value';
import {
  object,
  string,
  number,
  boolean,
  date,
  MixedSchema,
  ValidationError,
} from 'yup';

import buildTable, { saveSchema, Table } from './Table';
import { NotFoundError, UnauthorizedError } from './Errors';
import sse from './sse';

const refPlaceholder = -1;

type Relation<Context> = {
  column: string;
  key: string;
  table: Table<Context>;
};

export type Mode = 'insert' | 'read' | 'update' | 'delete';

export type ChangeSummary = {
  mode: Mode;
  schemaName: string;
  tableName: string;
  row: any;
};

export function notifyChange(
  emitter: EventEmitter,
  { mode, schemaName, tableName, row }: ChangeSummary
) {
  emitter.emit('change', {
    mode,
    tableName: tableName,
    schemaName: schemaName,
    row,
  });
}

const wrap = (
  fn: (req: Request, res: Response, next: NextFunction) => Promise<any>
) => async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await fn(req, res, next);
    if (result !== undefined) {
      res.send(result);
      res.end();
    }
  } catch (e) {
    next(e);
  }
};

export interface ContextFactory<Context> {
  (req: Request): Context;
}

export default function core<Context>(
  knex: Knex,
  getContext: ContextFactory<Context>,
  {
    emitter = new EventEmitter(),
  }: {
    emitter?: EventEmitter;
  } = {}
) {
  function trxNotifyCommit(
    trx: Transaction,
    mode: Mode,
    table: Table<Context>,
    row: any
  ) {
    trx.on('commit', () => {
      notifyChange(emitter, {
        mode,
        tableName: table.tableName,
        schemaName: table.schemaName,
        row,
      });
    });
  }

  const tables: Table<Context>[] = [];
  const relationsForCache = new Map<
    Table<Context>,
    { hasOne: Relation<Context>[]; hasMany: Relation<Context>[] }
  >();

  const query = (
    table: Table<Context>,
    k: Knex = knex,
    withDeleted: boolean = true
  ) => {
    const stmt = k(table.tablePath).select(`${table.tableName}.*`);

    if (table.paranoid) {
      if (!withDeleted) stmt.where(`${table.tableName}.deletedAt`, null);
    }

    return stmt;
  };

  const relationsFor = (
    table: Table<Context>
  ): { hasOne: Relation<Context>[]; hasMany: Relation<Context>[] } => {
    return relationsForCache.get(table)!;
  };

  const linksFor = (req: Request, table: Table<Context>, inputRow: any) => {
    let row = { ...inputRow };
    const relations = relationsFor(table);

    const { hasOne, hasMany } = relations;

    const result: { [key: string]: any } = {};

    for (let { table, column, key } of hasOne) {
      if (row[column] === null) continue;
      if (row[key] === undefined)
        result[key] = `${req.baseUrl}${table.path}/${row[column]}`;
      else row[key] = linksFor(req, table, row[key]);
    }

    for (let { table, column, key } of hasMany) {
      if (row[key] === undefined)
        result[key] = `${table.path}?${column}=${row.id}`;
      else row[key] = row[key].map((item: any) => linksFor(req, table, item));
    }

    return {
      ...row,
      '@url': `${req.baseUrl}${table.path}/${row.id}`,
      '@links': result,
    };
  };

  const filterGraph = (table: Table<Context>, graph: any) => {
    const result: { [key: string]: any } = {};

    for (let key of Object.keys(graph).filter(key => key in table.columns!)) {
      result[key] = graph[key];
    }

    return result;
  };

  const filterPrefixGraph = (table: Table<Context>, graph: any) => {
    const result: { [key: string]: any } = {};

    for (let key of Object.keys(graph).filter(key => key in table.columns!)) {
      let value = graph[key];

      if (table.columns![key].nullable && value === '') value = null;
      result[`${table.tableName}.${key}`] = value;
    }

    return result;
  };

  {
    const read = async (
      req: Request,
      table: Table<Context>,
      filters: any,
      many: boolean = true
    ) => {
      const withDeleted = Boolean(filters.withDeleted || !many);
      const context = getContext(req);

      const includeRelated = async (stmt: QueryBuilder) => {
        const { include: rawInclude = '' } = req.query;

        const include = rawInclude.split(',');

        for (let includeTable of include) {
          let isOne = true;
          let ref = relationsFor(table).hasOne.find(
            ref => ref.key === includeTable
          );

          if (!ref) {
            isOne = false;
            ref = relationsFor(table).hasMany.find(
              ref => ref.key === includeTable
            );
          }

          if (!ref) continue;

          let subQuery = query(ref.table, knex, withDeleted).clearSelect();

          // make sure tenant ids are forwarded to subQueries where possible
          if (table.tenantIdColumnName && ref!.table.tenantIdColumnName) {
            subQuery.where(
              `${ref!.table.tenantIdColumnName}`,
              `${table.tenantIdColumnName}`
            );
          }

          if (isOne) {
            subQuery
              .where(
                `${ref.table.tableName}.id`,
                knex.ref(`${table.tableName}.${ref.column}`)
              )
              .limit(1)
              .select(`row_to_json(${ref.table.tableName})`);
          } else {
            subQuery
              .where(
                `${ref.table.tableName}.${ref.column}`,
                knex.ref(`${table.tableName}.id`)
              )
              .limit(10)
              .select(`row_to_json(${ref.table.tableName})`);
          }

          await ref.table.policy(subQuery, context, 'read');

          if (isOne) {
            stmt.select(`(${subQuery.toString()}) as ${ref.key}`);
          } else {
            stmt.select(`array(${subQuery.toString()}) as ${ref.key}`);
          }
        }
      };

      const paginate = async (statement: QueryBuilder) => {
        const path = req.url.split('?').shift();
        const { sort } = req.query;
        const page = Number(req.query.page || 0);
        const limit = Math.max(0, Math.min(250, Number(req.query.limit) || 50));

        const sorts: { column: string; order: 'asc' | 'desc' }[] = [];
        if (sort) {
          sort.split(',').forEach((pair: string) => {
            const [column, order = 'asc'] = pair.split('.');

            if (
              column in table.columns! &&
              (order === 'asc' || order === 'desc')
            ) {
              sorts.push({ column, order });
            }
          });
        } else sorts.push({ column: 'id', order: 'asc' });

        if (req.query.lastId) {
          // keyset pagination
          statement
            .join(
              `${table.schemaName}.${table.tableName} as prev`,
              'prev.id',
              knex.raw('?', req.query.lastId)
            )
            .where(function() {
              sorts.map((sort, index) => {
                this.orWhere(function() {
                  sorts
                    .slice(0, index)
                    .map(({ column }) =>
                      this.where(
                        `${table.tableName}.${column}`,
                        '=',
                        knex.raw('??', `prev.${column}`)
                      )
                    );
                  this.where(
                    `${table.tableName}.${sort.column}`,
                    sort.order === 'asc' ? '>' : '<',
                    knex.raw('??', `prev.${sort.column}`)
                  );
                });
              });
            });
        } else {
          statement.offset(page * limit);
        }

        statement.limit(limit);

        if (sorts.length) {
          sorts.forEach(s =>
            statement.orderBy(`${table.tableName}.${s.column}`, s.order)
          );
        }

        const results = await statement;

        const links = {
          ...(!req.query.page
            ? {
                ...(results.length >= limit && {
                  nextPage: `${path}?${qs.stringify({
                    ...req.query,
                    lastId: results[results.length - 1].id,
                  })}`,
                }),
              }
            : {
                ...(results.length >= limit && {
                  nextPage: `${path}?${qs.stringify({
                    ...req.query,
                    page: page + 1,
                  })}`,
                }),
                ...(page !== 0 && {
                  previousPage: `${path}?${qs.stringify({
                    ...req.query,
                    page: page - 1,
                  })}`,
                }),
              }),
          count: `${path}/count${
            Object.keys(req.query).length > 0 ? '?' : ''
          }${qs.stringify(req.query)}`,
          ids: `${path}/ids${
            Object.keys(req.query).length > 0 ? '?' : ''
          }${qs.stringify(req.query)}`,
        };

        return {
          meta: {
            page,
            limit,
            hasMore: results.length >= limit,
            '@url': req.url,
            '@links': links,
          },
          data: results.map((item: any) => linksFor(req, table, item)),
        };
      };

      const stmt = query(table, knex, withDeleted);
      await table.policy(stmt, context, 'read');
      await includeRelated(stmt);

      const where = { ...filters };

      if (Object.keys(table.idModifiers).includes(where.id)) {
        const modifier = table.idModifiers[where.id];
        await modifier(stmt, context);
        delete where.id;
      }

      for (let key of Object.keys(where)) {
        if (Object.keys(table.queryModifiers).includes(key)) {
          const modifier = table.queryModifiers[key];
          await modifier(where[key], stmt, context);
          delete where[key];
        }
      }

      stmt.where(filterPrefixGraph(table, where));

      if (many) {
        return paginate(stmt);
      } else {
        const data = await stmt.first();

        if (!data) throw new NotFoundError();

        return {
          data: linksFor(req, table, data),
        };
      }
    };

    const count = async (req: Request, table: Table<Context>) => {
      const context = getContext(req);
      const filters = req.query;
      const withDeleted = Boolean(filters.withDeleted);

      const stmt = query(table, knex, withDeleted).clearSelect();
      await table.policy(stmt, context, 'read');

      stmt.where(filterPrefixGraph(table, filters));

      const where = { ...filters };

      if (Object.keys(table.idModifiers).includes(where.id)) {
        const modifier = table.idModifiers[where.id];
        await modifier(stmt, context);
        delete where.id;
      }

      for (let key of Object.keys(where)) {
        if (Object.keys(table.queryModifiers).includes(key)) {
          const modifier = table.queryModifiers[key];
          await modifier(where[key], stmt, context);
          delete where[key];
        }
      }

      stmt.where(filterPrefixGraph(table, where));

      return {
        data: await stmt
          .countDistinct(`${table.tableName}.id`)
          .then(([{ count }]) => Number(count)),
      };
    };

    const ids = async (req: Request, table: Table<Context>) => {
      const context = getContext(req);
      const filters = req.query;
      const withDeleted = Boolean(filters.withDeleted);

      const stmt = query(table, knex, withDeleted).clearSelect();
      await table.policy(stmt, context, 'read');

      stmt.where(filterPrefixGraph(table, filters));

      const where = { ...filters };

      if (Object.keys(table.idModifiers).includes(where.id)) {
        const modifier = table.idModifiers[where.id];
        await modifier(stmt, context);
        delete where.id;
      }

      for (let key of Object.keys(where)) {
        if (Object.keys(table.queryModifiers).includes(key)) {
          const modifier = table.queryModifiers[key];
          await modifier(where[key], stmt, context);
          delete where[key];
        }
      }

      stmt.where(filterPrefixGraph(table, where));

      const page = Number(req.query.page || 0);
      const limit = Math.max(
        0,
        Math.min(100000, Number(req.query.limit) || 1000)
      );

      stmt.offset(page * limit);
      stmt.limit(limit);
      const results = await stmt.pluck(`${table.tableName}.id`);

      return {
        meta: {
          page,
          limit,
          hasMore: results.length >= limit,
          '@url': req.url,
          '@links': {
            ...(results.length >= limit && {
              nextPage: `${req.path}?${qs.stringify({
                ...req.query,
                page: page + 1,
              })}`,
            }),
            ...(page !== 0 && {
              previousPage: `${req.path}?${qs.stringify({
                ...req.query,
                page: page - 1,
              })}`,
            }),
          },
        },
        data: results,
      };
    };

    const write = async (
      req: Request,
      res: Response,
      table: Table<Context>,
      graph: any
    ) => {
      const context = getContext(req);
      const beforeCommitCallbacks: Array<() => Promise<void>> = [];

      const validateGraph = async (table: Table<Context>, graph: any) => {
        const validate = async (table: Table<Context>, graph: any) => {
          const getYupSchema = () => {
            const schema: { [key: string]: MixedSchema } = {};

            for (let [column, info] of Object.entries(table.columns!)) {
              let type = postgresTypesToYupType(info.type).nullable();

              if (table.schema[column]) {
                type = type.concat(table.schema[column]);
              }

              if (!(info.nullable || info.defaultValue)) {
                type = type.test(
                  'is-null',
                  '${path} is required',
                  value => value !== null && value !== undefined
                );
              }

              schema[column] = type;
            }

            for (let columns of table.uniqueColumns) {
              for (let column of columns) {
                schema[column] = schema[column].test(
                  'unique',
                  '${path} is already in use',
                  async function test() {
                    const { parent } = this;
                    const where = Object.fromEntries(
                      columns.map(column => [column, parent[column]])
                    );

                    const stmt = query(table);
                    // There is no policy check here so rows that conflict
                    // that are not visible to the user

                    if (graph.id) {
                      stmt.whereNot(function() {
                        this.where(`${table.tableName}.id`, graph.id);
                        if (table.tenantIdColumnName) {
                          this.where(
                            `${table.tableName}.${table.tenantIdColumnName}`,
                            graph[table.tenantIdColumnName]
                          );
                        }
                      });
                    }

                    const existingRow = await stmt.where(where).first();

                    return !existingRow;
                  }
                );
              }
            }

            return object(schema);
          };

          if (graph.id) {
            const stmt = query(table);
            await table.policy(stmt, context, 'update');

            if (table.tenantIdColumnName && !graph[table.tenantIdColumnName])
              return { [table.tenantIdColumnName]: 'is required' };

            const existing = await stmt
              .where(`${table.tableName}.id`, graph.id)
              .modify(function() {
                if (table.tenantIdColumnName)
                  this.where(
                    table.tenantIdColumnName,
                    graph[table.tenantIdColumnName]
                  );
              })
              .first();

            if (!existing) throw new UnauthorizedError();

            graph = {
              ...existing,
              ...graph,
            };
          }

          try {
            const schema = await getYupSchema();
            for (let key in schema.describe().fields) {
              if (graph[key]) {
                const validator = (schema.describe().fields as any)[key];
                if (validator instanceof number) {
                  graph[key] = Number(graph[key]);
                }
                if (validator instanceof date) {
                  graph[key] = new Date(graph[key]);
                }
              }
            }

            await schema.validate(graph, {
              abortEarly: false,
              strict: true,
            });
            return {};
          } catch (err) {
            // in case a validator crashes we want to surface that through express
            /* istanbul ignore next */
            if (!(err instanceof ValidationError)) {
              throw err;
            }

            let errors = {};

            err.inner
              .map(e => {
                const path = e.path.replace(/\[|\]/g, '').split('.');
                return {
                  path: path.join('.'),
                  message: e.message.slice(e.message.indexOf(' ')).trim(),
                };
              })
              .forEach(({ message, path }) => setValue(errors, path, message));

            return errors;
          }
        };

        if (graph._delete) {
          if (table.tenantIdColumnName && !graph[table.tenantIdColumnName])
            return { [table.tenantIdColumnName]: 'is required' };

          return;
        }

        let errors: { [key: string]: any } = {};

        const { hasOne, hasMany } = relationsFor(table);

        for (let { column, key, table: otherTable } of hasOne) {
          const otherGraph = graph[key];
          if (otherGraph === undefined) continue;

          const otherErrors = await validateGraph(otherTable, otherGraph);

          graph[column] = (otherGraph as any).id || refPlaceholder;
          if (otherErrors) errors[key] = otherErrors;
        }

        errors = {
          ...errors,
          ...(await validate(table, filterGraph(table, graph))),
        };

        for (let { column, key, table: otherTable } of hasMany) {
          const otherGraphs = graph[key];
          if (otherGraphs === undefined || !Array.isArray(otherGraphs))
            continue;

          errors[key] = [];

          for (let otherGraph of otherGraphs) {
            const otherErrors = await validateGraph(otherTable, {
              ...otherGraph,
              [column]: (graph as any).id || refPlaceholder,
            });

            if (otherErrors) errors[key].push(otherErrors);
          }

          if (errors[key].length === 0) delete errors[key];
        }

        if (Object.keys(errors).length === 0) return undefined;

        return errors;
      };

      const updateGraph = async (
        trx: Transaction,
        table: Table<Context>,
        graph: any
      ) => {
        const update = async (
          trx: Transaction,
          table: Table<Context>,
          graph: any
        ) => {
          const initialGraph = graph;
          graph = filterGraph(table, graph);

          const stmt = query(table, trx);
          await table.policy(stmt, context, 'update');

          const row = await stmt
            .where(`${table.tableName}.id`, graph.id)
            .modify(function() {
              if (table.tenantIdColumnName && graph[table.tenantIdColumnName]) {
                this.where(
                  `${table.tableName}.${table.tenantIdColumnName}`,
                  graph[table.tenantIdColumnName]
                );
              }
            })
            .first();

          graph = { ...row, ...graph };

          if (table.beforeHook) {
            await table.beforeHook(trx, graph, 'update', context);

            graph = filterGraph(table, graph);
          }

          const filteredByChanged = Object.fromEntries(
            Object.entries(graph).filter(
              ([key, value]) => row[key] !== value && key !== 'id'
            )
          );

          {
            const stmt = query(table, trx);
            await table.policy(stmt, context, 'update');

            if (Object.keys(filteredByChanged).length) {
              await stmt
                .where(`${table.tableName}.id`, graph.id)
                .modify(function() {
                  if (
                    table.tenantIdColumnName &&
                    graph[table.tenantIdColumnName]
                  ) {
                    this.where(
                      `${table.tableName}.${table.tenantIdColumnName}`,
                      graph[table.tenantIdColumnName]
                    );
                  }
                })
                .limit(1)
                .update(filteredByChanged);
              trxNotifyCommit(trx, 'update', table, row);

              // in case an update now makes this row inaccessible
              const readStmt = query(table, trx);
              await table.policy(readStmt, context, 'update');

              const updatedRow = await readStmt
                .where(`${table.tableName}.id`, graph.id)
                .modify(function() {
                  if (
                    table.tenantIdColumnName &&
                    graph[table.tenantIdColumnName]
                  ) {
                    this.where(
                      `${table.tableName}.${table.tenantIdColumnName}`,
                      graph[table.tenantIdColumnName]
                    );
                  }
                })
                .first();

              if (!updatedRow) throw new UnauthorizedError();

              for (let key in initialGraph) {
                if (table.setters[key]) {
                  await table.setters[key](
                    trx,
                    initialGraph[key],
                    updatedRow,
                    context
                  );
                }
              }

              if (table.afterHook) {
                beforeCommitCallbacks.push(() => {
                  return table.afterHook!(trx, updatedRow, 'update', context);
                });
              }

              return updatedRow;
            } else return row;
          }
        };

        const insert = async (
          trx: Transaction,
          table: Table<Context>,
          graph: any
        ) => {
          const initialGraph = graph;
          graph = filterGraph(table, graph);

          if (table.beforeHook) {
            await table.beforeHook(trx, graph, 'insert', context);
            graph = filterGraph(table, graph);
          }

          const row = await query(table, trx)
            .insert(graph)
            .returning('*')
            .then(([row]) => row);

          trxNotifyCommit(trx, 'insert', table, row);

          const stmt = query(table, trx);
          await table.policy(stmt, context, 'insert');

          const updatedRow = await stmt
            .where(`${table.tableName}.id`, row.id)
            .first();

          if (!updatedRow) throw new UnauthorizedError();

          for (let key in initialGraph) {
            if (table.setters[key]) {
              await table.setters[key](
                trx,
                initialGraph[key],
                updatedRow,
                context
              );
            }
          }

          if (table.afterHook) {
            beforeCommitCallbacks.push(() => {
              return table.afterHook!(trx, updatedRow, 'insert', context);
            });
          }

          return updatedRow;
        };

        const del = async (
          trx: Transaction,
          table: Table<Context>,
          graph: any,
          deletedAt: Date = new Date()
        ) => {
          const { id } = graph;
          let tenantId: string | undefined = undefined;

          if (table.tenantIdColumnName) {
            tenantId = graph[table.tenantIdColumnName] || undefined;
          }

          const stmt = query(table, trx);
          await table.policy(stmt, context, 'delete');

          if (table.tenantIdColumnName && tenantId !== undefined) {
            stmt.where(
              `${table.tableName}.${table.tenantIdColumnName}`,
              tenantId
            );
          }

          const row = await stmt.where(`${table.tableName}.id`, id).first();

          if (!row) throw new UnauthorizedError();

          if (table.beforeHook) {
            await table.beforeHook(trx, row, 'delete', context);
          }

          if (table.afterHook) {
            beforeCommitCallbacks.push(() => {
              return table.afterHook!(trx, row, 'delete', context);
            });
          }

          async function cascade(table: Table<Context>) {
            const { hasMany } = relationsFor(table);
            for (let relation of hasMany) {
              if (!relation.table.paranoid) {
                // @TODO this means a non-paranoid row is looking at a paranoid row
                // cascading would delete that row too, but we don't want that.
                continue;
              }

              const [otherId] = await query(relation.table, trx)
                .select('id')
                .where(`${relation.table.tableName}.${relation.column}`, id)
                .modify(function() {
                  if (
                    relation.table.tenantIdColumnName &&
                    tenantId !== undefined
                  ) {
                    this.where(
                      `${relation.table.tableName}.${relation.table.tenantIdColumnName}`,
                      tenantId
                    );
                  }
                })
                .pluck('id');

              const otherGraph: any = { id: otherId };
              if (relation.table.tenantIdColumnName) {
                otherGraph[relation.table.tenantIdColumnName] = tenantId;
              }

              await del(trx, relation.table, otherGraph, deletedAt);
            }
          }

          const delStmt = query(table, trx).where(`${table.tableName}.id`, id);

          trxNotifyCommit(trx, 'delete', table, row);

          if (table.tenantIdColumnName && tenantId !== undefined) {
            delStmt.where(
              `${table.tableName}.${table.tenantIdColumnName}`,
              tenantId
            );
          }

          if (table.paranoid) {
            await delStmt.update({ deletedAt });
            await cascade(table);
          } else {
            await delStmt.delete();
          }
        };

        if (graph._delete) {
          await del(trx, table, graph);
          return null;
        }

        let row: { [key: string]: any } = { id: null };

        const { hasOne, hasMany } = relationsFor(table)!;

        for (let { column, key, table: otherTable } of hasOne) {
          const otherGraph = graph[key];
          if (otherGraph === undefined) continue;

          const otherRow = await updateGraph(trx, otherTable, otherGraph);

          if (otherRow && otherRow.id) {
            graph[column] = otherRow.id;
            row[key] = otherRow;
          }
        }

        if (graph.id) {
          row = {
            ...row,
            ...(await update(trx, table, graph)),
          };
        } else {
          row = {
            ...row,
            ...(await insert(trx, table, graph)),
          };
        }

        row = linksFor(req, table, row);

        for (let { column, key, table: otherTable } of hasMany) {
          const otherGraphs = graph[key];
          if (otherGraphs === undefined || !Array.isArray(otherGraphs))
            continue;

          row[key] = [];

          for (let otherGraph of otherGraphs) {
            const otherRow = await updateGraph(trx, otherTable, {
              ...otherGraph,
              [column]: row.id,
            });

            if (otherRow) row[key].push(otherRow);
          }
        }

        return row;
      };

      const errors = await validateGraph(table, graph);
      if (errors) {
        res.status(400);
        return {
          errors,
        };
      }

      let trxRef: null | Transaction = null;

      const data = await knex.transaction(async trx => {
        const result = await updateGraph(trx, table, graph);
        for (let cb of beforeCommitCallbacks) await cb();

        // Needs to emit commit after this function finishes
        trxRef = trx;

        return result;
      });

      if (trxRef) trxRef!.emit('commit');

      return { data };
    };

    type ShouldTypeBeSent = (
      event: ChangeSummary,
      context: Context
    ) => Promise<boolean>;

    let initializedModels = false;
    const app: Express & {
      table: (tableDef: Partial<Table<Context>>) => void;
      sse: (
        shouldEventBeSent: ShouldTypeBeSent
      ) => (req: Request, res: Response) => Promise<void>;
    } = Object.assign(express(), {
      table(tableDef: Partial<Table<Context>>) {
        if (initializedModels) {
          throw new Error(
            'Tables already initialized. Cannot register ' + tableDef.tableName
          );
        }
        tables.push(buildTable(tableDef));
      },
      sse(shouldEventBeSent: ShouldTypeBeSent) {
        return sse(emitter, getContext, shouldEventBeSent);
      },
    });

    app.use(
      wrap(async (_req, _res, next) => {
        if (initializedModels) return next();
        const fromFile = process.env.NODE_ENV === 'production';

        await Promise.all(tables.map(table => table.init(knex, fromFile)));

        if (!fromFile) await saveSchema();
        tables.forEach(table => {
          const relations = {
            hasOne: Object.entries(table.relations)
              .map(([column, tablePath]) => ({
                column,
                key: column.replace(/Id$/, ''),
                table: tables.find(m => m.tablePath === tablePath)!,
              }))
              .filter(r => r.table),
            hasMany: tables
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

          relationsForCache.set(table, relations);
        });

        initializedModels = true;

        for (let table of tables) {
          const { path } = table;

          app.use(path, table.router);

          app.get(
            `${path}/count`,
            wrap(async req => {
              return count(req, table);
            })
          );

          app.get(
            `${path}/ids`,
            wrap(async req => {
              return ids(req, table);
            })
          );

          app.get(
            `${path}/:id`,
            wrap(async req => {
              return read(
                req,
                table,
                { ...req.query, id: req.params.id },
                false
              );
            })
          );

          app.get(
            path,
            wrap(async req => {
              return read(req, table, req.query);
            })
          );

          app.post(
            path,
            wrap(async (req, res) => {
              return await write(req, res, table, req.body);
            })
          );

          app.put(
            `${path}/:id`,
            wrap(async (req, res) => {
              return await write(req, res, table, {
                ...req.body,
                id: isNaN(Number(req.params.id))
                  ? req.params.id
                  : Number(req.params.id),
              });
            })
          );

          app.delete(
            `${path}/:id`,
            wrap(async (req, res) => {
              const tenantId = table.tenantIdColumnName
                ? req.query[table.tenantIdColumnName]
                : undefined;

              return await write(req, res, table, {
                id: req.params.id,
                _delete: true,
                ...(tenantId !== undefined
                  ? { [table.tenantIdColumnName!]: tenantId }
                  : {}),
              });
            })
          );
        }

        next();
      })
    );

    return app;
  }
}

function postgresTypesToYupType(type: string): MixedSchema<any> {
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
      return string();
    case 'int2':
    case 'int4':
    case 'int8':
    case 'float4':
    case 'float8':
    case 'numeric':
    case 'money':
    case 'oid':
    case 'bigint':
    case 'integer':
      return number();
    case 'bool':
    case 'boolean':
      return boolean();
    case 'json':
    case 'jsonb':
      return object();
    case 'date':
    case 'timestamp':
    case 'timestamptz':
    case 'timestamp with time zone':
    case 'timestamp without time zone':
      return date();
    default:
      return string();
  }
}
