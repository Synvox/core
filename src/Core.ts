import { EventEmitter } from 'events';
import qs from 'qs';
import ms from 'ms';
import Knex, { Transaction, QueryBuilder } from 'knex';
import { Router, Request, Response, NextFunction } from 'express';
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

import Table, { saveSchema } from './Table';
import { NotFoundError, UnauthorizedError } from './Errors';

const refPlaceholder = -1;

type TableConfig = ReturnType<typeof Table>;

type Relation = {
  column: string;
  key: string;
  table: TableConfig;
};

export type ChangeSummary = {
  paths: Set<string>;
  tenantIds: Set<string>;
};

type Id = string | number;

export interface Authorizer {
  (req: Request, knex: Knex): {
    getUser: () => Promise<any>;
    getTenantIds: () => Promise<Id[]>;
  };
}

export default function core(
  knex: Knex,
  authorizer: Authorizer,
  {
    emitter = new EventEmitter(),
  }: {
    emitter?: EventEmitter;
  } = {}
) {
  const tables: TableConfig[] = [];
  const sseHandlers = new Set<(changeSummary: ChangeSummary) => void>();
  const relationsForCache = new Map<
    TableConfig,
    { hasOne: Relation[]; hasMany: Relation[] }
  >();
  let router: Router;

  emitter.on('commit', (changeSummary: ChangeSummary) => {
    sseHandlers.forEach(handler => handler(changeSummary));
  });

  const query = (table: TableConfig, k: Knex = knex) => {
    return k(table.tablePath).select(`${table.tableName}.*`);
  };

  const relationsFor = (
    table: TableConfig
  ): { hasOne: Relation[]; hasMany: Relation[] } => {
    return relationsForCache.get(table)!;
  };

  const linksFor = (req: Request, table: TableConfig, inputRow: any) => {
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

  const filterGraph = (table: TableConfig, graph: any) => {
    const result: { [key: string]: any } = {};

    for (let key of Object.keys(graph).filter(key => key in table.columns!)) {
      result[key] = graph[key];
    }

    return result;
  };

  const filterPrefixGraph = (table: TableConfig, graph: any) => {
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
      table: TableConfig,
      filters: any,
      many: boolean = true
    ) => {
      const authInstance = authorizer(req, knex);

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

          let subQuery = query(ref.table).clearSelect();
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

          await ref.table.policy(subQuery, authInstance, 'read');

          //@TODO is this right?
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
        const limit = Math.max(
          0,
          Math.min(250, Number(req.query.limit) || 250)
        );

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
        };

        return {
          meta: {
            page,
            perPage: limit,
            hasMore: results.length >= limit,
            '@url': req.url,
            '@links': links,
          },
          data: results.map((item: any) => linksFor(req, table, item)),
        };
      };

      const stmt = query(table);
      await table.policy(stmt, authInstance, 'read');
      await includeRelated(stmt);

      const where = { ...filters };

      if (Object.keys(table.idModifiers).includes(where.id)) {
        const modifier = table.idModifiers[where.id];
        await modifier(stmt, authInstance);
        delete where.id;
      }

      for (let key of Object.keys(where)) {
        if (Object.keys(table.queryModifiers).includes(key)) {
          const modifier = table.queryModifiers[key];
          await modifier(where[key], stmt, authInstance);
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

    const count = async (req: Request, table: TableConfig) => {
      const authInstance = authorizer(req, knex);
      const filters = req.query;

      const stmt = query(table).clearSelect();
      await table.policy(stmt, authInstance, 'read');

      stmt.where(filterPrefixGraph(table, filters));

      const where = { ...filters };

      if (Object.keys(table.idModifiers).includes(where.id)) {
        const modifier = table.idModifiers[where.id];
        await modifier(stmt, authInstance);
        delete where.id;
      }

      for (let key of Object.keys(where)) {
        if (Object.keys(table.queryModifiers).includes(key)) {
          const modifier = table.queryModifiers[key];
          await modifier(where[key], stmt, authInstance);
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

    const write = async (
      req: Request,
      res: Response,
      table: TableConfig,
      graph: any
    ) => {
      const authInstance = authorizer(req, knex);
      const beforeCommitCallbacks: Array<() => Promise<void>> = [];

      const validateGraph = async (table: TableConfig, graph: any) => {
        const validate = async (table: TableConfig, graph: any) => {
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
                    // this policy is in 'read' mode because we are looking
                    // for existence that may break unique constraints
                    await table.policy(stmt, authInstance, 'read');

                    if (graph.id) {
                      stmt.whereNot(`${table.tableName}.id`, graph.id);
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
            await table.policy(stmt, authInstance, 'update');

            const existing = await stmt
              .where(`${table.tableName}.id`, graph.id)
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
        table: TableConfig,
        graph: any,
        changeSummary: ChangeSummary
      ) => {
        const update = async (
          trx: Transaction,
          table: TableConfig,
          graph: any
        ) => {
          const initialGraph = graph;
          graph = filterGraph(table, graph);

          const stmt = query(table, trx);
          await table.policy(stmt, authInstance, 'update');

          const row = await stmt
            .where(`${table.tableName}.id`, graph.id)
            .first();

          graph = { ...row, ...graph };

          if (table.beforeHook) {
            await table.beforeHook(trx, graph, 'update', authInstance);

            graph = filterGraph(table, graph);
          }

          const filteredByChanged = Object.fromEntries(
            Object.entries(graph).filter(
              ([key, value]) => row[key] !== value && key !== 'id'
            )
          );

          {
            const stmt = query(table, trx);
            await table.policy(stmt, authInstance, 'update');

            if (Object.keys(filteredByChanged).length)
              await stmt
                .where(`${table.tableName}.id`, graph.id)
                .limit(1)
                .update(filteredByChanged);

            // in case an update now makes this row inaccessible
            const readStmt = query(table, trx);
            await table.policy(readStmt, authInstance, 'update');

            const updatedRow = await readStmt
              .where(`${table.tableName}.id`, graph.id)
              .first();

            if (!updatedRow) throw new UnauthorizedError();

            for (let key in initialGraph) {
              if (table.setters[key]) {
                await table.setters[key](
                  trx,
                  initialGraph[key],
                  updatedRow,
                  authInstance
                );
              }
            }

            if (table.afterHook) {
              beforeCommitCallbacks.push(() => {
                return table.afterHook!(
                  trx,
                  updatedRow,
                  'update',
                  authInstance
                );
              });
            }

            return updatedRow;
          }
        };

        const insert = async (
          trx: Transaction,
          table: TableConfig,
          graph: any
        ) => {
          const initialGraph = graph;
          graph = filterGraph(table, graph);

          if (table.beforeHook) {
            await table.beforeHook(trx, graph, 'insert', authInstance);
            graph = filterGraph(table, graph);
          }

          const row = await query(table, trx)
            .insert(graph)
            .returning('*')
            .then(([row]) => row);

          const stmt = query(table, trx);
          await table.policy(stmt, authInstance, 'insert');

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
                authInstance
              );
            }
          }

          if (table.afterHook) {
            beforeCommitCallbacks.push(() => {
              return table.afterHook!(trx, updatedRow, 'insert', authInstance);
            });
          }

          return updatedRow;
        };

        const del = async (
          trx: Transaction,
          table: TableConfig,
          id: string
        ) => {
          const stmt = query(table, trx);
          await table.policy(stmt, authInstance, 'delete');

          const row = await stmt.where(`${table.tableName}.id`, id).first();

          if (!row) throw new UnauthorizedError();

          if (table.beforeHook) {
            await table.beforeHook(trx, row, 'delete', authInstance);
          }

          if (table.afterHook) {
            beforeCommitCallbacks.push(() => {
              return table.afterHook!(trx, row, 'delete', authInstance);
            });
          }

          return await query(table, trx)
            .where(`${table.tableName}.id`, id)
            .delete();
        };

        changeSummary.paths.add(table.path);

        if (graph._delete) {
          const stmt = query(table, trx);
          await table.policy(stmt, authInstance, 'delete');

          const row = await stmt
            .where(`${table.tableName}.id`, graph.id)
            .first();

          if (table.tenantIdColumnName)
            changeSummary.tenantIds.add(row[table.tenantIdColumnName]);
          await del(trx, table, graph.id);
          return null;
        }

        let row: { [key: string]: any } = { id: null };

        const { hasOne, hasMany } = relationsFor(table)!;

        for (let { column, key, table: otherTable } of hasOne) {
          const otherGraph = graph[key];
          if (otherGraph === undefined) continue;

          const otherRow = await updateGraph(
            trx,
            otherTable,
            otherGraph,
            changeSummary
          );

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
            const otherRow = await updateGraph(
              trx,
              otherTable,
              {
                ...otherGraph,
                [column]: row.id,
              },
              changeSummary
            );

            if (otherRow) row[key].push(otherRow);
          }
        }

        if (table.tenantIdColumnName)
          changeSummary.tenantIds.add(row[table.tenantIdColumnName]);

        return row;
      };

      const changeSummary: ChangeSummary = {
        paths: new Set(),
        tenantIds: new Set(),
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
        const result = await updateGraph(trx, table, graph, changeSummary);
        for (let cb of beforeCommitCallbacks) await cb();

        // Needs to emit commit after this function finishes
        trxRef = trx;

        return result;
      });

      if (trxRef) trxRef!.emit('commit');

      emitter.emit('commit', changeSummary);

      return { data };
    };

    return {
      register(tableDef: Partial<TableConfig>) {
        tables.push(Table(tableDef));
      },
      emitChange(changeSummary: ChangeSummary) {
        emitter.emit('commit', changeSummary);
      },
      get router() {
        if (router) return router;
        router = Router();

        let initializedModels = false;

        function handler(
          handlerFn: (req: Request, res: Response) => Promise<any>
        ) {
          return async (req: Request, res: Response, next: NextFunction) => {
            if (!initializedModels) {
              const fromFile = process.env.NODE_ENV === 'production';

              await Promise.all(
                tables.map(table => table.init(knex, fromFile))
              );

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
                        .filter(
                          ([_, tablePath]) => tablePath === table.tablePath
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

                relationsForCache.set(table, relations);
              });

              initializedModels = true;
            }

            return handlerFn(req, res)
              .then((result: any) => {
                res.json(result);
                res.end();
              })
              .catch(next);
          };
        }

        for (let table of tables) {
          const { path } = table;

          router.use(path, table.router);

          router.get(
            `${path}/count`,
            handler(async req => {
              return count(req, table);
            })
          );

          router.get(
            `${path}/:id`,
            handler(async req => {
              return read(
                req,
                table,
                { ...req.query, id: req.params.id },
                false
              );
            })
          );

          router.get(
            path,
            handler(async req => {
              return read(req, table, req.query);
            })
          );

          router.post(
            path,
            handler(async (req, res) => {
              return await write(req, res, table, req.body);
            })
          );

          router.put(
            `${path}/:id`,
            handler(async (req, res) => {
              return await write(req, res, table, {
                ...req.body,
                id: isNaN(Number(req.params.id))
                  ? req.params.id
                  : Number(req.params.id),
              });
            })
          );

          router.delete(
            `${path}/:id`,
            handler(async (req, res) => {
              return await write(req, res, table, {
                id: req.params.id,
                _delete: true,
              });
            })
          );
        }

        router.get('/sse', async (req, res) => {
          res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            Connection: 'keep-alive',
          });
          res.write('\n');

          const tenantIds = await authorizer(req, knex).getTenantIds();

          const handler = (changeSummary: ChangeSummary) => {
            if (
              !Array.from(changeSummary.tenantIds).some(tenantId =>
                tenantIds.includes(tenantId)
              )
            ) {
              return;
            }

            const batch =
              [
                `id: ${Date.now()}`,
                'event: update',
                `data: ${JSON.stringify({
                  paths: Array.from(changeSummary.paths),
                })}`,
              ].join('\n') + '\n\n';

            res.write(batch);
          };

          const interval = setInterval(() => {
            res.write(':\n\n');
          }, ms('10s'));

          const onEnd = () => {
            sseHandlers.delete(handler);
            clearInterval(interval);
          };

          sseHandlers.add(handler);
          req.on('end', onEnd);
          req.on('close', onEnd);
        });

        return router;
      },
    };
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
