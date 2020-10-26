import { EventEmitter } from 'events';
import qs from 'qs';
import Knex, { Transaction, QueryBuilder } from 'knex';
import express, { Request, Response, NextFunction, Express } from 'express';
import setValue from 'set-value';
import atob from 'atob';
import btoa from 'btoa';
import {
  object,
  string,
  number,
  boolean,
  date,
  MixedSchema,
  ValidationError,
  array,
} from 'yup';
import buildTable, {
  saveSchema,
  Table,
  saveTsTypes,
  PartialTable,
  initTable,
} from './Table';
import { NotFoundError, UnauthorizedError, BadRequestError } from './Errors';
import sse from './sse';
import uploads from './uploads';

const refPlaceholder = -1;

type Relation<Context> = {
  column: string;
  key: string;
  table: Table<Context>;
};

export type ShouldEventBeSent<Context> = (
  isVisible: () => Promise<boolean>,
  event: ChangeSummary,
  context: Context
) => Promise<boolean>;

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

export const wrap = (
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

const qsStringify = (val: any) => {
  return qs.stringify(val, {
    encodeValuesOnly: true,
    arrayFormat: 'brackets',
  });
};

export interface ContextFactory<Context> {
  (req: Request, res: Response): Context;
}

export default function core<Context>(
  knex: Knex,
  getContext: ContextFactory<Context>,
  {
    emitter = new EventEmitter(),
    writeSchemaToFile = null,
    writeTypesToFile = null,
    includeLinksWithTypes = true,
    includeRelationsWithTypes = true,
    loadSchemaFromFile = process.env.NODE_ENV === 'production' &&
      Boolean(writeSchemaToFile),
    origin = '',
    forwardQueryParams = [],
  }: {
    emitter?: EventEmitter;
    writeSchemaToFile?: string | null;
    writeTypesToFile?: string | null;
    includeLinksWithTypes?: boolean;
    includeRelationsWithTypes?: boolean;
    loadSchemaFromFile?: boolean;
    origin?: string;
    forwardQueryParams?: string[];
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
    {
      knex: k = knex,
      withDeleted = true,
    }: {
      knex?: Knex;
      withDeleted?: boolean;
    } = {}
  ) => {
    let path = table.tablePath;
    if (table.tableName !== table.alias) path += ` ${table.alias}`;

    const stmt = k(path).select(`${table.alias}.*`);

    if (table.paranoid) {
      if (!withDeleted) stmt.where(`${table.alias}.deletedAt`, null);
    }

    return stmt;
  };

  const relationsFor = (
    table: Table<Context>
  ): { hasOne: Relation<Context>[]; hasMany: Relation<Context>[] } => {
    return relationsForCache.get(table)!;
  };

  const processTableRow = async (
    req: Request,
    context: Context,
    table: Table<Context>,
    inputRow: any,
    include: string[] = []
  ) => {
    let tenantId = null;
    if (table.tenantIdColumnName) {
      if (inputRow[table.tenantIdColumnName])
        tenantId = inputRow[table.tenantIdColumnName];
    }

    const forwardedQueryParams: { [key: string]: string } = Object.fromEntries(
      forwardQueryParams.map(key => [key, req.query[key]]).filter(([_, v]) => v)
    );

    let row = { ...inputRow };
    const relations = relationsFor(table);

    const { hasOne, hasMany } = relations;

    const result: { [key: string]: any } = {};

    for (let { table, column, key } of hasOne) {
      if (row[column] === null) continue;
      if (row[key] === undefined) {
        result[key] = `${origin}${req.baseUrl}${table.path}/${row[column]}`;
        const params: { [key: string]: string } = forwardedQueryParams;
        if (tenantId && table.tenantIdColumnName)
          params[table.tenantIdColumnName] = tenantId;
        if (Object.keys(params).length)
          result[key] += `?${qsStringify(params)}`;
      } else row[key] = await processTableRow(req, context, table, row[key]);
    }

    for (let { table, column, key } of hasMany) {
      if (row[key] === undefined) {
        result[key] = `${origin}${table.path}`;
        const params: { [key: string]: string } = {
          ...forwardedQueryParams,
          [column]: row.id,
        };
        if (tenantId && table.tenantIdColumnName)
          params[table.tenantIdColumnName] = tenantId;
        if (Object.keys(params).length)
          result[key] += `?${qsStringify(params)}`;
      } else
        row[key] = await Promise.all(
          row[key].map(
            async (item: any) =>
              await processTableRow(req, context, table, item)
          )
        );
    }

    let outputRow: any = {};
    for (let key in row) {
      if (row.hasOwnProperty(key) && !table.hiddenColumns.includes(key)) {
        outputRow[key] = row[key];
      }
    }

    let selectedGetters = [];
    for (let getterName in table.getters) {
      if (include.includes(getterName)) {
        selectedGetters.push(getterName);
        outputRow[getterName] = await table.getters[getterName].call(
          table,
          row,
          context
        );
      } else {
        result[getterName] = `${origin}${table.path}/${row.id}/${getterName}`;
        const params: { [key: string]: string } = forwardedQueryParams;
        if (tenantId && table.tenantIdColumnName)
          params[table.tenantIdColumnName] = tenantId;
        if (Object.keys(params).length)
          result[getterName] += `?${qsStringify(params)}`;
      }
    }

    let rowQueryParams: { [key: string]: any } = forwardedQueryParams;

    if (table.tenantIdColumnName && tenantId) {
      rowQueryParams[table.tenantIdColumnName] = tenantId;
    }

    if (selectedGetters.length > 0) {
      rowQueryParams.include = selectedGetters;
    }

    let selfUrl = `${origin}${req.baseUrl}${table.path}/${row.id}`;

    if (Object.keys(rowQueryParams).length > 0) {
      selfUrl += `?${qsStringify(rowQueryParams)}`;
    }

    return {
      ...outputRow,
      '@url': selfUrl,
      '@links': result,
    };
  };

  const filterGraph = (table: Table<Context>, graph: any) => {
    const result: { [key: string]: any } = {};

    for (let key of Object.keys(graph).filter(key => key in table.columns!)) {
      if (!table.readOnlyColumns.includes(key)) {
        result[key] = graph[key];
      }
    }

    return result;
  };

  const getWhereFiltersForTable = (table: Table<Context>, graph: any) => {
    const result: { [key: string]: any } = {};

    for (let key of Object.keys(graph).filter(key => key in table.columns!)) {
      let value = graph[key];

      if (table.columns![key].nullable && value === '') value = null;
      result[`${table.alias}.${key}`] = value;
    }

    return result;
  };

  const applyModifiers = async (
    stmt: QueryBuilder,
    table: Table<Context>,
    context: Context,
    where: any
  ) => {
    if (Object.keys(table.idModifiers).includes(where.id)) {
      const modifier = table.idModifiers[where.id];
      await modifier.call(table, stmt, context);
      delete where.id;
    }

    for (let key of Object.keys(where)) {
      if (Object.keys(table.queryModifiers).includes(key)) {
        const modifier = table.queryModifiers[key];
        await modifier.call(table, where[key], stmt, context);
        delete where[key];
      }
    }
  };

  {
    const read = async (
      context: Context,
      req: Request,
      _res: Response,
      table: Table<Context>,
      filters: any,
      many: boolean = true
    ) => {
      let { include = [] } = req.query;

      if (typeof include === 'string') include = [include];

      const withDeleted = Boolean(filters.withDeleted || !many);

      if (table.tenantIdColumnName) {
        const tenantId = filters[table.tenantIdColumnName];
        if (!tenantId) throw new BadRequestError();
      }

      const includeRelated = async (stmt: QueryBuilder) => {
        let refCount = 0;
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
          const alias =
            ref.table.tableName === table.tableName
              ? `${ref.table.tableName}__self_ref_alias_${refCount++}`
              : ref.table.tableName;

          let subQuery = query(
            { ...ref.table, alias },
            { knex, withDeleted }
          ).clearSelect();

          // make sure tenant ids are forwarded to subQueries where possible
          if (table.tenantIdColumnName && ref!.table.tenantIdColumnName) {
            subQuery.where(
              `${alias}.${ref!.table.tenantIdColumnName}`,
              knex.raw(`${table.alias}.${table.tenantIdColumnName}`)
            );
          }

          if (isOne) {
            subQuery
              .where(`${alias}.id`, knex.ref(`${table.alias}.${ref.column}`))
              .limit(1)
              .select(`row_to_json(${alias})`);
          } else {
            subQuery
              .where(`${alias}.${ref.column}`, knex.ref(`${table.alias}.id`))
              .limit(10)
              .select(`row_to_json(${alias})`);
          }

          await ref.table.policy.call(
            { ...ref.table, alias },
            subQuery,
            context,
            'read'
          );

          if (isOne) {
            stmt.select(`(${subQuery.toString()}) as ${ref.key}`);
          } else {
            stmt.select(`array(${subQuery.toString()}) as ${ref.key}`);
          }
        }
      };

      const paginate = async (statement: QueryBuilder) => {
        const path = req.url.split('?').shift();
        let { sort } = req.query;
        const page = Number(req.query.page || 0);
        const limit = Math.max(0, Math.min(250, Number(req.query.limit) || 50));

        const sorts: { column: string; order: 'asc' | 'desc' }[] = [];
        if (sort) {
          if (!Array.isArray(sort)) sort = [sort];

          sort.forEach((column: string) => {
            let order = 'asc';
            if (column.startsWith('-')) {
              order = 'desc';
              column = column.slice(1);
            }

            if (
              column in table.columns! &&
              (order === 'asc' || order === 'desc')
            ) {
              sorts.push({ column, order });
            }
          });
        }

        if (req.query.cursor) {
          const cursor = JSON.parse(atob(req.query.cursor));
          // keyset pagination
          statement.where(function() {
            sorts.forEach((sort, index) => {
              this.orWhere(function() {
                sorts
                  .slice(0, index)
                  .map(({ column }) =>
                    this.where(
                      `${table.tableName}.${column}`,
                      '=',
                      cursor[column]
                    )
                  );
                this.where(
                  `${table.tableName}.${sort.column}`,
                  sort.order === 'asc' ? '>' : '<',
                  cursor[sort.column]
                );
              });
            });
          });
        } else {
          statement.offset(page * limit);
        }

        statement.limit(limit);

        if (sorts.length === 0) {
          sorts.push({ column: 'id', order: 'asc' });
        }

        sorts.forEach(s =>
          statement.orderBy(`${table.alias}.${s.column}`, s.order)
        );

        const results = await statement;

        const links = {
          ...(!req.query.page
            ? {
                ...(results.length >= limit && {
                  nextPage: `${origin}${path}?${qsStringify({
                    ...req.query,
                    cursor: btoa(JSON.stringify(results[results.length - 1])),
                  })}`,
                }),
              }
            : {
                ...(results.length >= limit && {
                  nextPage: `${origin}${path}?${qsStringify({
                    ...req.query,
                    page: page + 1,
                  })}`,
                }),
                ...(page !== 0 && {
                  previousPage: `${origin}${path}?${qsStringify({
                    ...req.query,
                    page: page - 1,
                  })}`,
                }),
              }),
          count: `${origin}${path}/count${
            Object.keys(req.query).length > 0 ? '?' : ''
          }${qsStringify(req.query)}`,
          ids: `${origin}${path}/ids${
            Object.keys(req.query).length > 0 ? '?' : ''
          }${qsStringify(req.query)}`,
        };

        return {
          meta: {
            page,
            limit,
            hasMore: results.length >= limit,
            '@url': `${origin}${req.url}`,
            '@links': links,
          },
          data: await Promise.all(
            results.map(
              async (item: any) =>
                await processTableRow(req, context, table, item, include)
            )
          ),
        };
      };

      const stmt = query(table, { knex, withDeleted });
      await table.policy.call(table, stmt, context, 'read');
      await includeRelated(stmt);

      const where = { ...filters };

      await applyModifiers(stmt, table, context, where);

      stmt.where(getWhereFiltersForTable(table, where));

      if (many) {
        return paginate(stmt);
      } else {
        const data = await stmt.first();

        if (!data) throw new NotFoundError();

        return {
          data: await processTableRow(req, context, table, data, include),
        };
      }
    };

    const count = async (
      context: Context,
      req: Request,
      _res: Response,
      table: Table<Context>
    ) => {
      const filters = req.query;
      const withDeleted = Boolean(filters.withDeleted);

      const stmt = query(table, { knex, withDeleted }).clearSelect();
      await table.policy.call(table, stmt, context, 'read');

      stmt.where(getWhereFiltersForTable(table, filters));

      const where = { ...filters };

      await applyModifiers(stmt, table, context, where);

      stmt.where(getWhereFiltersForTable(table, where));

      return {
        data: await stmt
          .countDistinct(`${table.alias}.id`)
          .then(([{ count }]) => Number(count)),
      };
    };

    const ids = async (
      context: Context,
      req: Request,
      _res: Response,
      table: Table<Context>
    ) => {
      const filters = req.query;
      const withDeleted = Boolean(filters.withDeleted);

      const stmt = query(table, { knex, withDeleted }).clearSelect();
      await table.policy.call(table, stmt, context, 'read');

      stmt.where(getWhereFiltersForTable(table, filters));

      const where = { ...filters };

      await applyModifiers(stmt, table, context, where);

      stmt.where(getWhereFiltersForTable(table, where));

      const page = Number(req.query.page || 0);
      const limit = Math.max(
        0,
        Math.min(100000, Number(req.query.limit) || 1000)
      );

      stmt.offset(page * limit);
      stmt.limit(limit);
      const results = await stmt.pluck(`${table.alias}.id`);

      return {
        meta: {
          page,
          limit,
          hasMore: results.length >= limit,
          '@url': `${origin}${req.url}`,
          '@links': {
            ...(results.length >= limit && {
              nextPage: `${origin}${req.path}?${qs.stringify({
                ...req.query,
                page: page + 1,
              })}`,
            }),
            ...(page !== 0 && {
              previousPage: `${origin}${req.path}?${qs.stringify({
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
      context: Context,
      req: Request,
      res: Response,
      table: Table<Context>,
      graph: any
    ) => {
      const beforeCommitCallbacks: Array<() => Promise<void>> = [];

      const fixUpserts = async (table: Table<Context>, graph: any) => {
        const { hasOne, hasMany } = relationsFor(table);

        for (let { column, key, table: otherTable } of hasOne) {
          const otherGraph = graph[key];
          if (otherGraph === undefined) continue;
          if (otherGraph.id) graph[column] = (otherGraph as any).id;
          graph[key] = await fixUpserts(otherTable, otherGraph);
        }

        for (let { key, column, table: otherTable } of hasMany) {
          const otherGraphs = graph[key];
          if (otherGraphs === undefined || !Array.isArray(otherGraphs))
            continue;

          graph[key] = await Promise.all(
            graph[key].map((otherGraph: any) =>
              fixUpserts(otherTable, {
                ...otherGraph,
                [column]: (graph as any).id || otherGraph[column],
              })
            )
          );
        }

        if (
          !table.allowUpserts ||
          graph._delete ||
          graph.id ||
          !table.uniqueColumns.every(columns =>
            columns.every(column => graph[column])
          )
        ) {
          return graph;
        }

        // if there is a row, see if we can upsert to it
        for (let columns of table.uniqueColumns) {
          const upsertCheckStmt = query(table).first();

          for (let column of columns) {
            if (graph[column])
              upsertCheckStmt.where(`${table.alias}.${column}`, graph[column]);
          }

          table.policy.call(table, upsertCheckStmt, context, 'update');

          const viewAbleRow = await upsertCheckStmt;

          if (viewAbleRow) {
            const graphCopy = { ...graph };
            Object.assign(graph, viewAbleRow, graphCopy);
          }
        }

        return graph;
      };

      const validateGraph = async (table: Table<Context>, graph: any) => {
        const validate = async (table: Table<Context>, graph: any) => {
          const getYupSchema = () => {
            const schema: { [key: string]: MixedSchema } = {};

            for (let [column, info] of Object.entries(table.columns!)) {
              let type = postgresTypesToYupType(info.type).nullable();

              if (table.schema[column]) {
                type = type.concat(table.schema[column]);
              }

              if (info.type.endsWith('[]')) {
                type = array(type);
              }

              if (!(info.nullable || info.defaultValue)) {
                type = type.test(
                  'is-null',
                  // eslint-disable-next-line no-template-curly-in-string
                  '${path} is required',
                  value => value !== null && value !== undefined
                );
              }

              schema[column] = type;
            }

            for (let columns of table.uniqueColumns) {
              for (let column of columns) {
                const g = graph;
                if (g[column] === undefined) continue;
                schema[column] = schema[column].test(
                  'unique',
                  // eslint-disable-next-line no-template-curly-in-string
                  '${path} is already in use',
                  async function test() {
                    const { parent } = this;
                    const where = Object.fromEntries(
                      columns.map(column => [
                        `${table.alias}.${column}`,
                        parent[column],
                      ])
                    );

                    // if we don't have every column, abort and pass the test
                    if (!Object.values(where).every(v => v !== undefined))
                      return true;

                    const stmt = query(table);
                    // There is no policy check here so rows that conflict
                    // that are not visible to the user

                    if (g.id) {
                      stmt.whereNot(function() {
                        this.where(`${table.alias}.id`, g.id);
                        if (table.tenantIdColumnName) {
                          this.where(
                            `${table.alias}.${table.tenantIdColumnName}`,
                            g[table.tenantIdColumnName]
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
            await table.policy.call(table, stmt, context, 'update');

            if (table.tenantIdColumnName && !graph[table.tenantIdColumnName])
              return { [table.tenantIdColumnName]: 'is required' };

            const existing = await stmt
              .where(`${table.alias}.id`, graph.id)
              .modify(function() {
                if (table.tenantIdColumnName)
                  this.where(
                    `${table.alias}.${table.tenantIdColumnName}`,
                    graph[table.tenantIdColumnName]
                  );
              })
              .first();

            if (!existing) {
              throw new UnauthorizedError();
            }

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
                if (validator.type === 'number') {
                  graph[key] = Number(graph[key]);
                }
                if (validator.type === 'date') {
                  graph[key] = new Date(graph[key]);
                }
                if (validator.type === 'boolean') {
                  graph[key] = Boolean(graph[key]) && graph[key] !== 'false';
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

            err.inner
              .map(e => {
                const REPLACE_BRACKETS = /\[([^[\]]+)\]/g;
                const LFT_RT_TRIM_DOTS = /^[.]*|[.]*$/g;
                const dotPath = e.path
                  .replace(REPLACE_BRACKETS, '.$1')
                  .replace(LFT_RT_TRIM_DOTS, '');

                return {
                  path: dotPath,
                  message: e.message.slice(e.message.indexOf(' ')).trim(),
                };
              })
              .forEach(({ message, path }) => {
                setValue(errors, path, message);
              });

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

          const stmt = query(table, { knex: trx });
          await table.policy.call(table, stmt, context, 'update');

          const row = await stmt
            .where(`${table.alias}.id`, graph.id)
            .modify(function() {
              if (table.tenantIdColumnName && graph[table.tenantIdColumnName]) {
                this.where(
                  `${table.alias}.${table.tenantIdColumnName}`,
                  graph[table.tenantIdColumnName]
                );
              }
            })
            .first();

          graph = { ...row, ...graph };

          await table.beforeUpdate.call(
            table,
            trx,
            context,
            'update',
            graph,
            row
          );

          graph = filterGraph(table, graph);

          const filteredByChanged = Object.fromEntries(
            Object.entries(graph).filter(
              ([key, value]) => row[key] !== value && key !== 'id'
            )
          );

          {
            const stmt = query(table, { knex: trx });
            await table.policy.call(table, stmt, context, 'update');

            if (
              Object.keys(filteredByChanged).length ||
              Object.keys(table.setters).some(key => key in initialGraph)
            ) {
              if (Object.keys(filteredByChanged).length)
                await stmt
                  .where(`${table.alias}.id`, graph.id)
                  .modify(function() {
                    if (
                      table.tenantIdColumnName &&
                      graph[table.tenantIdColumnName]
                    ) {
                      this.where(
                        `${table.alias}.${table.tenantIdColumnName}`,
                        graph[table.tenantIdColumnName]
                      );
                    }
                  })
                  .limit(1)
                  .update(filteredByChanged);
              trxNotifyCommit(trx, 'update', table, row);

              // in case an update now makes this row inaccessible
              const readStmt = query(table, { knex: trx });
              await table.policy.call(table, readStmt, context, 'update');

              const updatedRow = await readStmt
                .where(`${table.alias}.id`, graph.id)
                .modify(function() {
                  if (
                    table.tenantIdColumnName &&
                    graph[table.tenantIdColumnName]
                  ) {
                    this.where(
                      `${table.alias}.${table.tenantIdColumnName}`,
                      graph[table.tenantIdColumnName]
                    );
                  }
                })
                .first();

              if (!updatedRow) throw new UnauthorizedError();

              for (let key in initialGraph) {
                if (table.setters[key]) {
                  await table.setters[key].call(
                    table,
                    trx,
                    initialGraph[key],
                    updatedRow,
                    context
                  );
                }
              }

              if (table.afterUpdate) {
                beforeCommitCallbacks.push(() => {
                  return table.afterUpdate!.call(
                    table,
                    trx,
                    context,
                    'update',
                    updatedRow,
                    row
                  );
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

          if (table.beforeUpdate) {
            await table.beforeUpdate.call(
              table,
              trx,
              context,
              'insert',
              graph,
              undefined
            );
            graph = filterGraph(table, graph);
          }

          const row = await query(table, { knex: trx })
            .insert(graph)
            .returning('*')
            .then(([row]) => row);

          trxNotifyCommit(trx, 'insert', table, row);

          const stmt = query(table, { knex: trx });
          await table.policy.call(table, stmt, context, 'insert');

          let updatedRow = await stmt
            .where(`${table.alias}.id`, row.id)
            .first();

          if (!updatedRow) throw new UnauthorizedError();

          let didUseSetter = false;
          for (let key in initialGraph) {
            if (table.setters[key]) {
              didUseSetter = true;
              await table.setters[key](
                trx,
                initialGraph[key],
                updatedRow,
                context
              );
            }
          }

          if (didUseSetter) {
            updatedRow = await stmt.where(`${table.alias}.id`, row.id).first();
          }

          if (table.afterUpdate) {
            beforeCommitCallbacks.push(() => {
              return table.afterUpdate!.call(
                table,
                trx,
                context,
                'insert',
                updatedRow,
                undefined
              );
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

          const stmt = query(table, { knex: trx });
          await table.policy.call(table, stmt, context, 'delete');

          if (table.tenantIdColumnName && tenantId !== undefined) {
            stmt.where(`${table.alias}.${table.tenantIdColumnName}`, tenantId);
          }

          const row = await stmt.where(`${table.alias}.id`, id).first();

          if (!row) throw new UnauthorizedError();

          if (table.beforeUpdate) {
            await table.beforeUpdate.call(
              table,
              trx,
              context,
              'delete',
              undefined,
              row
            );
          }

          beforeCommitCallbacks.push(() => {
            return table.afterUpdate.call(
              table,
              trx,
              context,
              'delete',
              undefined,
              row
            );
          });

          async function cascade(table: Table<Context>) {
            const { hasMany } = relationsFor(table);
            for (let relation of hasMany) {
              if (!relation.table.paranoid) {
                // @TODO this means a non-paranoid row is looking at a paranoid row
                // cascading would delete that row too, but we don't want that.
                continue;
              }

              const [otherId] = await query(relation.table, { knex: trx })
                .select('id')
                .where(`${relation.table.alias}.${relation.column}`, id)
                .modify(function() {
                  if (
                    relation.table.tenantIdColumnName &&
                    tenantId !== undefined
                  ) {
                    this.where(
                      `${relation.table.alias}.${relation.table.tenantIdColumnName}`,
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

          const delStmt = query(table, { knex: trx }).where(
            `${table.alias}.id`,
            id
          );

          trxNotifyCommit(trx, 'delete', table, row);

          if (table.tenantIdColumnName && tenantId !== undefined) {
            delStmt.where(
              `${table.alias}.${table.tenantIdColumnName}`,
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

        row = await processTableRow(req, context, table, row);

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

      graph = await fixUpserts(table, graph);

      const errors = await validateGraph(table, graph);
      if (errors) {
        res.status(400);
        return {
          errors,
        };
      }

      let trxRef: null | Transaction = null;

      const data = await knex.transaction(async trx => {
        // Needs to emit commit after this function finishes
        trxRef = trx;

        const result = await updateGraph(trx, table, graph);
        for (let cb of beforeCommitCallbacks) await cb();

        return result;
      });

      trxRef!.emit('commit');

      return { data };
    };

    let initializedModels = false;
    const app: Express & {
      table: (tableDef: PartialTable<Context>) => void;
      sse: (
        shouldEventBeSent?: ShouldEventBeSent<Context>
      ) => (req: Request, res: Response) => Promise<void>;
      uploads: typeof uploads;
    } = Object.assign(express(), {
      table(tableDef: PartialTable<Context>) {
        if (initializedModels) {
          throw new Error(
            'Tables already initialized. Cannot register ' + tableDef.tableName
          );
        }
        tables.push(buildTable(tableDef));
      },
      sse(shouldEventBeSent?: ShouldEventBeSent<Context>) {
        return sse(knex, emitter, getContext, tables, shouldEventBeSent);
      },
      uploads,
    });

    app.use(
      wrap(async (_req, _res, next) => {
        if (initializedModels) return next();

        await Promise.all(
          tables.map(table =>
            initTable(
              table,
              knex,
              loadSchemaFromFile ? writeSchemaToFile : null
            )
          )
        );

        if (process.env.NODE_ENV !== 'production' && writeTypesToFile) {
          await saveTsTypes(
            writeTypesToFile,
            includeLinksWithTypes,
            includeRelationsWithTypes
          );
        }

        if (process.env.NODE_ENV !== 'production' && writeSchemaToFile) {
          await saveSchema(writeSchemaToFile);
        }

        tables.forEach(table => {
          const relations = {
            hasOne: Object.entries(table.relations)
              .map(([column, { path: tablePath }]) => ({
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

          relationsForCache.set(table, relations);
        });

        initializedModels = true;

        for (let table of tables) {
          const { path } = table;

          app.use(path, table.router);

          app.get(
            `${path}/count`,
            wrap(async (req, res) => {
              const context = getContext(req, res);
              return count(context, req, res, table);
            })
          );

          app.get(
            `${path}/ids`,
            wrap(async (req, res) => {
              const context = getContext(req, res);
              return ids(context, req, res, table);
            })
          );

          for (let getterName in table.getters) {
            app.get(
              `${path}/:id/${getterName}`,
              wrap(async (req, res) => {
                const context = getContext(req, res);

                const { data: row } = await read(
                  context,
                  req,
                  res,
                  table,
                  { ...req.query, id: req.params.id },
                  false
                );

                return {
                  data: await table.getters[getterName].call(
                    table,
                    row,
                    context
                  ),
                };
              })
            );
          }

          app.get(
            `${path}/:id`,
            wrap(async (req, res) => {
              const context = getContext(req, res);
              return read(
                context,
                req,
                res,
                table,
                { ...req.query, id: req.params.id },
                false
              );
            })
          );

          app.get(
            path,
            wrap(async (req, res) => {
              const context = getContext(req, res);
              return read(context, req, res, table, req.query);
            })
          );

          for (let methodName in table.methods) {
            app.post(
              `${path}/:id/${methodName}`,
              wrap(async (req, res) => {
                const { id } = req.params;

                const context = getContext(req, res);
                const stmt = query(table, { knex })
                  .where(`${table.tableName}.id`, id)
                  .first();
                if (table.tenantIdColumnName) {
                  if (req.query[table.tenantIdColumnName]) {
                    stmt.where(
                      `${table.tableName}.${table.tenantIdColumnName}`,
                      req.query[table.tenantIdColumnName]
                    );
                  } else {
                    throw new BadRequestError();
                  }
                }

                await table.policy.call(table, stmt, context, 'read');

                const row = await stmt;
                if (!row) throw new NotFoundError();

                return await table.methods[methodName](row, context, req.body);
              })
            );
          }

          app.post(
            path,
            wrap(async (req, res) => {
              const context = getContext(req, res);
              return await write(context, req, res, table, req.body);
            })
          );

          app.put(
            `${path}/:id`,
            wrap(async (req, res) => {
              const context = getContext(req, res);
              return await write(context, req, res, table, {
                ...req.body,
                id: req.params.id,
              });
            })
          );

          app.delete(
            `${path}/:id`,
            wrap(async (req, res) => {
              const context = getContext(req, res);
              const tenantId = table.tenantIdColumnName
                ? req.query[table.tenantIdColumnName]
                : undefined;

              return await write(context, req, res, table, {
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
