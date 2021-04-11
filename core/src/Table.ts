import { EventEmitter } from "events";
import { Router } from "express";
import { classify } from "inflection";
import { Knex } from "knex";
import qs from "qs";
import atob from "atob";
import btoa from "btoa";
import { object, array, StringSchema, mixed } from "yup";
import { v4 as uuidv4 } from "uuid";
import {
  Policy,
  YupSchema,
  IdModifiers,
  QueryModifiers,
  Setters,
  EagerGetters,
  Getters,
  Columns,
  Relations,
  RelatedTable,
  BeforeUpdate,
  AfterUpdate,
  TableDef,
  RelatedTables,
  Mode,
  Mixed,
  ChangeSummary,
  Methods,
  StaticMethods,
} from "./types";
import {
  getColumnInfo,
  getUniqueColumnIndexes,
  getRelations,
} from "./introspect";
import {
  BadRequestError,
  UnauthorizedError,
  NotFoundError,
  ComplexityError,
} from "./errors";
import { postgresTypesToYupType } from "./lookups";
import { toSnakeCase } from "./case";
import { Result, CollectionResult, ChangeResult } from "./Result";
import { qsStringify } from "./qsStringify";
import { validateAgainst } from "./validate";

export type SavedTable = {
  columns: Columns;
  uniqueColumns: string[][];
  relations: Relations;
};

export class Table<Context, T = any> {
  path: string;
  tableName: string;
  schemaName: string;
  tenantIdColumnName: string | null;
  idColumnName: string;
  policy: Policy<Context>;
  schema: YupSchema;
  readOnlyColumns: string[];
  hiddenColumns: string[];
  paranoid: boolean;
  router: Router;
  idModifiers: IdModifiers<Context>;
  queryModifiers: QueryModifiers<Context>;
  setters: Setters<Context>;
  eagerGetters: EagerGetters<Context>;
  getters: Getters<Context>;
  inverseOfColumnName: Record<string, string>;
  columns: Columns;
  uniqueColumns: string[][];
  relations: Relations;
  alias: string;
  relatedTables: {
    hasOne: Record<string, RelatedTable<Context>>;
    hasMany: Record<string, RelatedTable<Context>>;
  };
  beforeUpdate?: BeforeUpdate<Context>;
  afterUpdate?: AfterUpdate<Context>;
  baseUrl: string;
  forwardQueryParams: string[];
  idGenerator?: () => any;
  eventEmitter?: EventEmitter;
  defaultParams: (
    context: Context,
    mode: Omit<Mode, "delete">
  ) => Promise<Partial<T>>;
  allowUpserts: boolean;
  complexityLimit: number;
  complexityWeight: number;
  defaultSortColumn: string;
  methods: Methods<Context>;
  staticMethods: StaticMethods<Context>;

  constructor(def: TableDef<Context>) {
    this.path =
      def.path ?? [def.schemaName, def.tableName].filter(Boolean).join("/");
    this.tableName = def.tableName;
    this.schemaName = def.schemaName ?? "public";
    this.tenantIdColumnName = def.tenantIdColumnName ?? null;
    this.idColumnName = def.idColumnName ?? "id";
    this.policy = def.policy ?? (async () => {});
    this.schema = def.schema ?? {};
    this.readOnlyColumns = def.readOnlyColumns ?? [];
    this.hiddenColumns = def.hiddenColumns ?? [];
    this.paranoid = def.paranoid ?? false;
    this.router = def.router ?? Router();
    this.idModifiers = def.idModifiers ?? {};
    this.queryModifiers = def.queryModifiers ?? {};
    this.setters = def.setters ?? {};
    this.eagerGetters = def.eagerGetters ?? {};
    this.getters = def.getters ?? {};
    this.inverseOfColumnName = def.inverseOfColumnName ?? {};
    this.columns = def.columns ?? {};
    this.uniqueColumns = def.uniqueColumns ?? [];
    this.relations = def.relations ?? {};
    this.alias = this.tableName;
    this.relatedTables = { hasMany: {}, hasOne: {} };
    this.beforeUpdate = def.beforeUpdate;
    this.afterUpdate = def.afterUpdate;
    this.baseUrl = def.baseUrl ?? "";
    this.forwardQueryParams = def.forwardQueryParams ?? [];
    this.idGenerator = def.idGenerator;
    this.eventEmitter = def.eventEmitter;
    this.defaultParams = def.defaultParams ?? (async () => ({}));
    this.allowUpserts = def.allowUpserts ?? false;
    this.complexityLimit = def.complexityLimit ?? 500;
    this.complexityWeight = def.complexityWeight ?? 1;
    this.defaultSortColumn = def.defaultSortColumn ?? this.idColumnName;
    this.methods = def.methods ?? {};
    this.staticMethods = def.staticMethods ?? {};
  }

  private withAlias(alias: string) {
    return Object.assign(new Table<Context, T>(this), this, { alias });
  }

  async init(knex: Knex) {
    const [columns, uniqueConstraintIndexes, relations] = await Promise.all([
      getColumnInfo(
        knex,
        toSnakeCase(this.schemaName),
        toSnakeCase(this.tableName)
      ),
      getUniqueColumnIndexes(
        knex,
        toSnakeCase(this.schemaName),
        toSnakeCase(this.tableName)
      ),
      getRelations(
        knex,
        toSnakeCase(this.schemaName),
        toSnakeCase(this.tableName)
      ),
    ]);

    if (Object.keys(columns).length === 0)
      throw new Error(`The table ${this.tablePath} did not have any columns.`);

    this.columns = {
      ...columns,
      ...this.columns,
    };

    this.uniqueColumns = [
      ...uniqueConstraintIndexes.map((indexes) =>
        indexes.map(
          (index: number) =>
            Object.keys(this.columns)[
              index - 1
              // table is 1 indexed in postgres
            ]
        )
      ),
      ...this.uniqueColumns,
    ];

    this.relations = { ...relations, ...this.relations };

    if (this.paranoid && !("deletedAt" in this.columns))
      throw new Error(
        "Tried to make a paranoid table without a deletedAt column"
      );
  }

  linkTables(tables: Table<Context>[]) {
    const getTablePath = (t: { tableName: string; schemaName: string }) =>
      `${t.schemaName}.${t.tableName}`;

    for (let table of tables) {
      if (table === this) continue;
      if (getTablePath(table) === this.tablePath)
        throw new Error(`The table at ${this.tablePath} was registered twice.`);
    }

    const hasOne: RelatedTables<Context> = {};

    for (let [column, relation] of Object.entries(this.relations)) {
      const otherPath = getTablePath({
        tableName: relation.referencesTable,
        schemaName: relation.referencesSchema,
      });

      const otherTable = tables.find(
        (otherTable) => otherPath === getTablePath(otherTable)
      );

      if (!otherTable) continue;

      const name = column.replace(/Id$/, "");
      hasOne[name] = { relation, table: otherTable, name };
    }

    const hasMany: RelatedTables<Context> = {};

    const myTablePath = getTablePath(this);
    for (let otherTable of tables) {
      for (let [columnName, relation] of Object.entries(otherTable.relations)) {
        const otherPath = getTablePath({
          tableName: relation.referencesTable,
          schemaName: relation.referencesSchema,
        });

        if (otherPath !== myTablePath) continue;

        const name =
          otherTable.inverseOfColumnName[columnName] ?? otherTable.tableName;

        if (hasMany[name])
          throw new Error(
            `Cannot bind ${name} on ${this.tablePath}. Define an inverse on ${otherTable.tablePath}: inverseOfColumnName: {${columnName}: 'pluralName'}`
          );

        hasMany[name] = { relation, table: otherTable, name };
      }
    }

    this.relatedTables = {
      hasOne,
      hasMany,
    };
  }

  get tablePath() {
    return `${this.schemaName}.${this.tableName}`;
  }

  get className() {
    return classify(this.tableName);
  }

  query(knex: Knex) {
    let path = this.tablePath;
    if (this.tableName !== this.alias) path += ` ${this.alias}`;

    const stmt = knex(path);

    for (let columnName of Object.keys(this.columns)) {
      stmt.select(`${this.alias}.${columnName}`);
    }

    return stmt;
  }

  private async validateWhere(
    params: any,
    context: Context
  ): Promise<[any, Record<string, string>]> {
    const errors: Record<string, string> = {};
    const clone = { ...params };

    for (let [key, value] of Object.entries(params)) {
      const [columnName] = key.split(".");
      if (columnName === "and" || columnName === "or") {
        const [val, err] = await this.validateWhere(value, context);
        clone[key] = val;
        Object.assign(errors, err);
        continue;
      }

      if (!(columnName in this.columns) && !(columnName in this.schema))
        continue;

      if (
        columnName === this.idColumnName &&
        (value as string) in this.idModifiers
      )
        continue;

      const schema = object({
        [columnName]: this.getYupTypeForColumn(columnName),
      });

      const isArray = Array.isArray(value);
      const arr: any[] = isArray ? (value as any[]) : [value];
      const result: any[] = [];

      for (let value of arr) {
        const [
          { [columnName]: castValue },
          columnErrors,
        ] = await validateAgainst(schema, { [columnName]: value }, context);

        Object.assign(errors, columnErrors);
        result.push(castValue);
      }

      Object.assign(clone, { [key]: isArray ? result : result[0] });
    }

    return [clone, errors];
  }

  private async where(
    stmt: Knex.QueryBuilder,
    context: Context,
    params: Record<string, any>
  ) {
    if (this.tenantIdColumnName && !params[this.tenantIdColumnName])
      throw new BadRequestError({
        [this.tenantIdColumnName]: `is required`,
      });

    function translateOp<Opts extends Record<string, string>>(
      opts: Opts,
      selected: string,
      defaultKey: keyof Opts
    ) {
      return opts[selected] ?? opts[defaultKey];
    }

    const applyFilter = (
      stmt: Knex.QueryBuilder,
      params: Record<string, any>
    ) => {
      for (let [key, value] of Object.entries(params)) {
        const [columnName, ...operands] = key.split(".");
        let not = false;
        if (operands[0] === "not") {
          operands.shift();
          not = true;
        }

        if (columnName === this.idColumnName && value in this.idModifiers) {
          // this is an id modifier, and it is async. Ignore it here.
        } else if (columnName === "or") {
          stmt.orWhere((stmt) => applyFilter(stmt, value));
        } else if (columnName === "and") {
          stmt.andWhere((stmt) => applyFilter(stmt, value));
        } else if (this.columns[columnName]) {
          const op = operands[0];
          if (op === "fts") {
            stmt.whereRaw(
              (not ? "not " : "") + "to_tsvector(??.??) @@ plainto_tsquery(?)",
              [this.alias, columnName, value]
            );
          } else if (Array.isArray(value)) {
            const method = not ? "whereNotIn" : "whereIn";
            stmt[method](`${this.alias}.${columnName}`, value);
          } else {
            const method = not ? "whereNot" : "where";
            stmt[method](
              `${this.alias}.${columnName}`,
              translateOp(
                {
                  eq: "=",
                  neq: "<>",
                  lt: "<",
                  lte: "<=",
                  gt: ">",
                  gte: ">=",
                },
                op,
                "eq"
              ),
              value
            );
          }
        }
      }
    };

    for (let [columnName, value] of Object.entries(params)) {
      if (columnName === this.idColumnName && value in this.idModifiers) {
        await this.idModifiers[value].call(this, stmt, context);
      } else if (this.queryModifiers[columnName]) {
        await this.queryModifiers[columnName].call(this, value, stmt, context);
      }
    }

    stmt.where((stmt) => {
      applyFilter(stmt, params);
    });

    if (this.paranoid) {
      if (!params.withDeleted) stmt.where(`${this.alias}.deletedAt`, null);
    }
  }

  private async applyPolicy(
    stmt: Knex.QueryBuilder,
    context: Context,
    mode: Mode
  ) {
    await this.policy(stmt, context, mode);
  }

  private filterWritable(obj: any) {
    const result: { [key: string]: any } = {};

    for (let key of Object.keys(obj).filter((key) => key in this.columns)) {
      if (
        !this.readOnlyColumns.includes(key) &&
        !this.hiddenColumns.includes(key)
      ) {
        result[key] = obj[key];
      }
    }

    return result;
  }

  private async processTableRow(
    queryParams: Record<string, any>,
    context: Context,
    inputRow: any,
    include: string[] = []
  ): Promise<Result<T> & T> {
    let tenantId = this.tenantIdColumnName
      ? inputRow[this.tenantIdColumnName]
      : null;

    const forwardedQueryParams: { [key: string]: string } = Object.fromEntries(
      this.forwardQueryParams
        .map((key) => [key, queryParams[key]])
        .filter(([_, v]) => v)
    );

    let row = { ...inputRow };

    const { hasOne, hasMany } = this.relatedTables;

    const result: { [key: string]: any } = {};

    for (let [
      key,
      {
        table,
        relation: { columnName: column },
      },
    ] of Object.entries(hasOne)) {
      if (row[column] === null) continue;
      result[key] = `${table.baseUrl}/${table.path}/${row[column]}`;
      const params: { [key: string]: string } = { ...forwardedQueryParams };
      if (tenantId && table.tenantIdColumnName)
        params[table.tenantIdColumnName] = tenantId;
      if (Object.keys(params).length) result[key] += `?${qsStringify(params)}`;
      if (row[key] !== undefined)
        row[key] = await table.processTableRow(queryParams, context, row[key]);
    }

    for (let [
      key,
      {
        table,
        relation: { columnName: column },
      },
    ] of Object.entries(hasMany)) {
      const params: { [key: string]: string } = {
        ...forwardedQueryParams,
        [column]: row[this.idColumnName],
      };

      if (tenantId && table.tenantIdColumnName)
        params[table.tenantIdColumnName] = tenantId;

      result[key] = `${table.baseUrl}/${table.path}?${qsStringify(params)}`;

      if (row[key] !== undefined)
        row[key] = await Promise.all(
          row[key].map(
            async (item: any) =>
              await table.processTableRow(queryParams, context, item)
          )
        );
    }

    let outputRow: any = {};
    for (let key in row) {
      if (row.hasOwnProperty(key) && !this.hiddenColumns.includes(key)) {
        outputRow[key] = row[key];
      }
    }

    let selectedGetters = [];
    for (let getterName in this.getters) {
      if (include.includes(getterName)) {
        selectedGetters.push(getterName);
        outputRow[getterName] = await this.getters[getterName].call(
          this,
          row,
          context
        );
      }
      result[getterName] = `${this.baseUrl}/${this.path}/${
        row[this.idColumnName]
      }/${getterName}`;
      const params: { [key: string]: string } = { ...forwardedQueryParams };
      if (
        tenantId &&
        this.tenantIdColumnName &&
        this.idColumnName !== this.tenantIdColumnName
      )
        params[this.tenantIdColumnName] = tenantId;
      if (Object.keys(params).length)
        result[getterName] += `?${qsStringify(params)}`;
    }

    for (let getterName in this.eagerGetters) {
      result[getterName] = `${this.baseUrl}/${this.path}/${
        row[this.idColumnName]
      }/${getterName}`;
      const params: { [key: string]: string } = { ...forwardedQueryParams };
      if (Object.keys(params).length)
        result[getterName] += `?${qsStringify(params)}`;
    }

    let rowQueryParams: { [key: string]: any } = forwardedQueryParams;

    if (
      this.tenantIdColumnName &&
      tenantId &&
      this.tenantIdColumnName !== this.idColumnName
    ) {
      rowQueryParams[this.tenantIdColumnName] = tenantId;
    }

    if (selectedGetters.length > 0) {
      rowQueryParams.include = selectedGetters;
    }

    let selfUrl = `${this.baseUrl}/${this.path}/${row[this.idColumnName]}`;

    if (Object.keys(rowQueryParams).length > 0) {
      selfUrl += `?${qsStringify(rowQueryParams)}`;
    }

    return new Result<T>(outputRow, {
      url: selfUrl,
      links: result,
      type: this.path,
    }) as Result<T> & T;
  }

  getYupSchema({
    partial = false,
  }: {
    partial?: boolean;
  } = {}) {
    const table = this;

    const schema: { [key: string]: Mixed } = {};

    for (let [column, info] of Object.entries(table.columns!)) {
      let type = this.getYupTypeForColumn(column);

      if (this.schema[column]) {
        type = type.concat(this.schema[column].nullable());
      }

      const notNullable = !info.nullable;
      const hasDefault =
        info.defaultValue !== null ||
        (column === this.idColumnName && this.idGenerator);

      if (notNullable && !partial) {
        type = type.test(
          "null",
          "${path} is a required field",
          (v: any) => v !== null
        );

        if (!hasDefault) type = type.required();
      }

      schema[column] = type;
    }

    return schema;
  }

  getYupTypeForColumn(column: string) {
    const info = this.columns[column];
    let type = postgresTypesToYupType(info.type).nullable();

    if (type.type === "string" && info.length >= 0) {
      type = ((type as StringSchema).max(info.length) as unknown) as Mixed;
    }

    if (info.type.endsWith("[]")) {
      type = array(type);
    }

    return type;
  }

  private getYupSchemaWithUniqueKeys(knex: Knex) {
    const table = this;

    const schema: { [key: string]: Mixed } = {};
    for (let columns of table.uniqueColumns) {
      for (let column of columns) {
        schema[column] = mixed().test(
          "unique",
          // eslint-disable-next-line no-template-curly-in-string
          "${path} is already in use",
          async function test(value) {
            if (value === undefined) return true;
            const { parent } = this;
            const where = Object.fromEntries(
              columns.map((column) => [
                `${table.alias}.${column}`,
                parent[column],
              ])
            );

            // if we don't have every column, abort and pass the test
            if (!Object.values(where).every((v) => v !== undefined))
              return true;

            const stmt = table.query(knex);
            // There is no policy check here so rows that conflict
            // are found that are not visible to the user

            if (parent[table.idColumnName]) {
              stmt.whereNot(function () {
                this.where(
                  `${table.alias}.${[table.idColumnName]}`,
                  parent[table.idColumnName]
                );
                if (table.tenantIdColumnName) {
                  this.where(
                    `${table.alias}.${table.tenantIdColumnName}`,
                    parent[table.tenantIdColumnName]
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

    return schema;
  }

  private getYupSchemaWithChildren(knex: Knex, context: Context) {
    const schema: { [key: string]: Mixed } = {};

    for (let { table: otherTable, relation } of Object.values(
      this.relatedTables.hasOne
    )) {
      const table = this;

      schema[relation.columnName] = mixed()
        .test("is not null", "${path} is required", async function test(value) {
          return value !== null;
        })
        .test(
          "exists",
          // eslint-disable-next-line no-template-curly-in-string
          "${path} was not found",
          async function test(value) {
            const refPlaceholderNumber = 0;
            const refPlaceholderUUID = "00000000-0000-0000-0000-000000000000";
            if (
              value === undefined ||
              value === null ||
              value === refPlaceholderNumber ||
              value === refPlaceholderUUID
            )
              return true;

            const { parent } = this;

            const stmt = otherTable
              .query(knex)
              .clear("select")
              .select(`${otherTable.alias}.${otherTable.idColumnName}`)
              .where(`${otherTable.alias}.${otherTable.idColumnName}`, value);

            await otherTable.applyPolicy(stmt, context, "read");

            if (table.tenantIdColumnName && otherTable.tenantIdColumnName) {
              stmt.where(
                `${otherTable.alias}.${otherTable.tenantIdColumnName}`,
                parent[table.tenantIdColumnName]
              );
            }

            const existingRow = await stmt.first();

            return existingRow;
          }
        );
    }

    return schema;
  }

  private async validate(
    knex: Knex,
    obj: any,
    context: Context
  ): Promise<[any, Record<string, string>]> {
    const table = this;

    if (obj[this.idColumnName]) {
      obj = { ...(await this.defaultParams(context, "update")), ...obj };
    } else {
      obj = { ...(await this.defaultParams(context, "insert")), ...obj };
    }

    let existingSchema = object();
    if (table.tenantIdColumnName) {
      if (!obj[table.tenantIdColumnName])
        return [obj, { [table.tenantIdColumnName]: "is required" }];
      existingSchema = existingSchema.concat(
        object({
          [table.tenantIdColumnName]: postgresTypesToYupType(
            table.columns![table.tenantIdColumnName].type
          ),
        })
      );
    }

    if (obj[this.idColumnName]) {
      existingSchema = existingSchema.concat(
        object({
          [this.idColumnName]: postgresTypesToYupType(
            table.columns![this.idColumnName].type
          ),
        })
      );

      const [objCast, preValidate] = await validateAgainst(
        existingSchema,
        obj,
        context
      );
      obj = objCast;

      if (Object.keys(preValidate).length > 0) return [obj, preValidate];

      const stmt = this.query(knex);
      const params: Record<string, any> = {
        [this.idColumnName]: obj[this.idColumnName],
      };

      if (
        this.tenantIdColumnName &&
        this.idColumnName !== this.tenantIdColumnName
      )
        params[this.tenantIdColumnName] = obj[this.tenantIdColumnName];

      await this.where(stmt, context, params);
      await this.applyPolicy(stmt, context, "update");

      const existing = await stmt.first();

      if (!existing) {
        throw new UnauthorizedError();
      }

      obj = {
        ...existing,
        ...obj,
      };
    }

    const schema = object(this.getYupSchemaWithUniqueKeys(knex))
      .concat(object(this.getYupSchemaWithChildren(knex, context)))
      .concat(object(this.getYupSchema()));

    return await validateAgainst(schema, obj, context);
  }

  async validateDeep(
    knex: Knex,
    obj: any,
    context: Context,
    changesRemaining: number = this.complexityLimit
  ): Promise<[any, Record<string, string> | undefined]> {
    let errors: Record<string, any> = {};

    const refPlaceholderNumber = 0;
    const refPlaceholderUUID = "00000000-0000-0000-0000-000000000000";

    changesRemaining -= this.complexityWeight;
    if (changesRemaining <= 0) throw new ComplexityError();

    if (obj._delete) {
      if (this.tenantIdColumnName && !obj[this.tenantIdColumnName])
        return [obj, { [this.tenantIdColumnName]: "is required" }];

      return [obj, undefined];
    }

    const placeholderFor = (table: Table<Context>) => {
      return postgresTypesToYupType(table.columns![table.idColumnName].type)
        .type === "string"
        ? refPlaceholderUUID
        : refPlaceholderNumber;
    };

    for (let [
      name,
      {
        table: otherTable,
        relation: { columnName },
      },
    ] of Object.entries(this.relatedTables.hasOne)) {
      const otherGraph = obj[name];
      if (otherGraph === undefined) continue;

      const [otherGraphValidated, otherErrors] = await otherTable.validateDeep(
        knex,
        otherGraph,
        context,
        changesRemaining
      );

      obj[name] = otherGraphValidated;

      obj[columnName] =
        (otherGraph as any)[this.idColumnName] || placeholderFor(otherTable);
      if (otherErrors) errors[name] = otherErrors;
    }

    const [objValidated, objErrors] = await this.validate(
      knex,
      this.filterWritable(obj),
      context
    );

    errors = {
      ...errors,
      ...objErrors,
    };

    obj = {
      ...obj,
      ...objValidated,
    };

    for (let [
      name,
      {
        table: otherTable,
        relation: { columnName },
      },
    ] of Object.entries(this.relatedTables.hasMany)) {
      const otherGraphs = obj[name];
      if (otherGraphs === undefined || !Array.isArray(otherGraphs)) continue;

      errors[name] = {};
      let hadError = false;

      for (let [index, otherGraph] of Object.entries(otherGraphs)) {
        const [
          otherGraphValidated,
          otherErrors,
        ] = await otherTable.validateDeep(
          knex,
          {
            ...otherGraph,
            [columnName]:
              (obj as any)[this.idColumnName] || placeholderFor(otherTable),
          },
          context,
          changesRemaining
        );

        //@TODO come back to this
        //@ts-expect-error
        otherGraphs[index] = otherGraphValidated;

        if (otherErrors) {
          hadError = true;
          errors[name][index] = otherErrors;
        }
      }

      if (!hadError) delete errors[name];
    }

    if (Object.keys(errors).length === 0) return [obj, undefined];

    return [obj, errors];
  }

  private async updateDeep(
    trx: Knex.Transaction,
    obj: any,
    context: Context,
    beforeCommitCallbacks: (() => Promise<void>)[],
    changes: ChangeSummary<any>[]
  ) {
    const recordChange = async (mode: Mode, row: any) => {
      changes.push({
        path: this.path,
        mode: mode,
        row: await this.processTableRow({}, context, row),
      });
    };

    const update = async (graph: any) => {
      const table = this;
      const initialGraph = graph;
      graph = this.filterWritable(graph);

      const readStmt = table.query(trx);
      await table.applyPolicy(readStmt, context, "update");

      const row = await readStmt
        .where(
          `${table.alias}.${[table.idColumnName]}`,
          graph[table.idColumnName]
        )
        .modify(function () {
          if (table.tenantIdColumnName && graph[table.tenantIdColumnName]) {
            this.where(
              `${table.alias}.${table.tenantIdColumnName}`,
              graph[table.tenantIdColumnName]
            );
          }
        })
        .first();

      // if the row is deleted between validation and update
      if (!row) return null;

      graph = { ...row, ...graph };

      if (table.beforeUpdate) {
        await table.beforeUpdate.call(
          table,
          trx,
          context,
          "update",
          graph,
          row
        );

        graph = this.filterWritable(graph);
      }

      const filteredByChanged = Object.fromEntries(
        Object.entries(graph).filter(
          ([key, value]) => row[key] !== value && key !== this.idColumnName
        )
      );

      const stmt = table.query(trx);
      await table.applyPolicy(stmt, context, "update");

      if (
        Object.keys(filteredByChanged).length ||
        Object.keys(table.setters).some((key) => key in initialGraph)
      ) {
        if (Object.keys(filteredByChanged).length)
          await stmt
            .where(
              `${table.alias}.${[table.idColumnName]}`,
              graph[table.idColumnName]
            )
            .modify(function () {
              if (table.tenantIdColumnName && graph[table.tenantIdColumnName]) {
                this.where(
                  `${table.alias}.${table.tenantIdColumnName}`,
                  graph[table.tenantIdColumnName]
                );
              }
            })
            .update(filteredByChanged);

        // in case an update now makes this row inaccessible
        const readStmt = table.query(trx);
        await table.applyPolicy(readStmt, context, "update");

        const updatedRow = await readStmt
          .where(
            `${table.alias}.${table.idColumnName}`,
            row[table.idColumnName]
          )
          .modify(function () {
            if (table.tenantIdColumnName && graph[table.tenantIdColumnName]) {
              this.where(
                `${table.alias}.${table.tenantIdColumnName}`,
                graph[table.tenantIdColumnName]
              );
            }
          })
          .first();

        if (!updatedRow) throw new UnauthorizedError();

        await recordChange("update", updatedRow);

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
              "update",
              updatedRow,
              row
            );
          });
        }

        return updatedRow;
      } else return row;
    };

    const insert = async (graph: any) => {
      const table = this;
      const initialGraph = graph;

      if (this.idGenerator) graph[this.idColumnName] = this.idGenerator();

      graph = table.filterWritable(graph);

      if (table.beforeUpdate) {
        await table.beforeUpdate.call(
          table,
          trx,
          context,
          "insert",
          graph,
          undefined
        );
        graph = table.filterWritable(graph);
      }

      const row = await table
        .query(trx)
        .insert(graph)
        .returning("*")
        .then(([row]) => row);

      await recordChange("insert", row);

      const stmt = table.query(trx);
      await table.applyPolicy(stmt, context, "insert");

      let updatedRow = await stmt
        .where(`${table.alias}.${table.idColumnName}`, row[table.idColumnName])
        .modify(function () {
          if (table.tenantIdColumnName && graph[table.tenantIdColumnName]) {
            this.where(
              `${table.alias}.${table.tenantIdColumnName}`,
              graph[table.tenantIdColumnName]
            );
          }
        })
        .first();

      if (!updatedRow) throw new UnauthorizedError();

      let didUseSetter = false;
      for (let key in initialGraph) {
        if (table.setters[key]) {
          didUseSetter = true;
          await table.setters[key](trx, initialGraph[key], updatedRow, context);
        }
      }

      if (didUseSetter) {
        updatedRow = await stmt.clone();
      }

      if (table.afterUpdate) {
        beforeCommitCallbacks.push(() => {
          return table.afterUpdate!.call(
            table,
            trx,
            context,
            "insert",
            updatedRow,
            undefined
          );
        });
      }

      return updatedRow;
    };

    const del = async (
      graph: any,
      deletedAt: Date = new Date(),
      table: Table<Context> = this
    ) => {
      const { [this.idColumnName]: id } = graph;
      let tenantId: string | undefined = undefined;

      if (table.tenantIdColumnName) {
        tenantId = graph[table.tenantIdColumnName];
      }

      const stmt = table.query(trx);
      await table.applyPolicy(stmt, context, "delete");

      if (table.tenantIdColumnName && tenantId !== undefined) {
        stmt.where(`${table.alias}.${table.tenantIdColumnName}`, tenantId);
      }

      const row = await stmt
        .where(`${table.alias}.${table.idColumnName}`, id)
        .first();

      if (!row) throw new UnauthorizedError();

      if (table.beforeUpdate) {
        await table.beforeUpdate.call(
          table,
          trx,
          context,
          "delete",
          undefined,
          row
        );
      }

      if (table.afterUpdate)
        beforeCommitCallbacks.push(() => {
          return table.afterUpdate!.call(
            table,
            trx,
            context,
            "delete",
            undefined,
            row
          );
        });

      async function cascade(table: Table<Context>) {
        const { hasMany } = table.relatedTables;
        for (let {
          table: otherTable,
          relation: { columnName },
        } of Object.values(hasMany)) {
          if (!otherTable.paranoid) {
            // This means a non-paranoid row is looking at a paranoid row
            // cascading would delete that row too, but we don't want that.
            continue;
          }

          const stmt = otherTable
            .query(trx)
            .where(`${otherTable.alias}.${columnName}`, id)
            .modify(function () {
              if (table.tenantIdColumnName && tenantId !== undefined) {
                this.where(
                  `${otherTable.alias}.${otherTable.tenantIdColumnName}`,
                  tenantId
                );
              }
            })
            .clear("select")
            .pluck(`${otherTable.alias}.${otherTable.idColumnName}`);

          const otherIds = await stmt;
          for (let otherId of otherIds) {
            const otherGraph: any = { [otherTable.idColumnName]: otherId };
            if (otherTable.tenantIdColumnName) {
              otherGraph[otherTable.tenantIdColumnName] = tenantId;
            }

            await del(otherGraph, deletedAt, otherTable);
          }
        }
      }

      const delStmt = table
        .query(trx)
        .where(`${table.alias}.${table.idColumnName}`, id);

      await recordChange("delete", row);

      if (table.tenantIdColumnName && tenantId !== undefined) {
        delStmt.where(`${table.alias}.${table.tenantIdColumnName}`, tenantId);
      }

      if (table.paranoid) {
        await delStmt.update({ deletedAt });
        await cascade(table);
      } else {
        await delStmt.delete();
      }
    };

    if (obj._delete) {
      await del(obj);
      return null;
    }

    let row: { [key: string]: any } = { [this.idColumnName]: null };

    const { hasOne, hasMany } = this.relatedTables;

    for (let [
      key,
      {
        relation: { columnName },
        table: otherTable,
      },
    ] of Object.entries(hasOne)) {
      const otherGraph = obj[key];
      if (otherGraph === undefined) continue;

      const otherRow = await otherTable.updateDeep(
        trx,
        otherGraph,
        context,
        beforeCommitCallbacks,
        changes
      );

      if (otherRow && otherRow[otherTable.idColumnName]) {
        obj[columnName] = otherRow[otherTable.idColumnName];
        row[key] = otherRow;
      }
    }

    if (obj[this.idColumnName]) {
      const updated = await update(obj);

      // if the row could not be found (happens on cascade from a relation)
      if (updated === null) return null;

      row = {
        ...row,
        ...updated,
      };
    } else {
      row = {
        ...row,
        ...(await insert(obj)),
      };
    }

    row = await this.processTableRow({}, context, row);

    for (let [
      key,
      {
        relation: { columnName },
        table: otherTable,
      },
    ] of Object.entries(hasMany)) {
      const otherGraphs = obj[key];
      if (otherGraphs === undefined || !Array.isArray(otherGraphs)) continue;

      row[key] = [];

      for (let otherGraph of otherGraphs) {
        const otherRow = await otherTable.updateDeep(
          trx,
          {
            ...otherGraph,
            [columnName]: row[this.idColumnName],
          },
          context,
          beforeCommitCallbacks,
          changes
        );

        if (otherRow) row[key].push(otherRow);
      }
    }

    return row as T;
  }

  async count(knex: Knex, queryParams: Record<string, any>, context: Context) {
    queryParams = {
      ...(await this.defaultParams(context, "read")),
      ...queryParams,
    };

    const stmt = this.query(knex);
    await this.where(stmt, context, queryParams);
    await this.applyPolicy(stmt, context, "read");

    stmt.clear("select");

    return await stmt
      .countDistinct(`${this.alias}.${this.idColumnName}`)
      .then(([{ count }]) => Number(count));
  }

  async ids(knex: Knex, queryParams: Record<string, any>, context: Context) {
    queryParams = {
      ...(await this.defaultParams(context, "read")),
      ...queryParams,
    };

    const stmt = this.query(knex);
    await this.where(stmt, context, queryParams);
    await this.applyPolicy(stmt, context, "read");

    const page = Number(queryParams.page || 0);
    const limit = Math.max(
      0,
      Math.min(100000, Number(queryParams.limit) || 1000)
    );

    stmt.clear("select");
    stmt.offset(page * limit);
    stmt.limit(limit);
    const results = await stmt.pluck(`${this.alias}.${this.idColumnName}`);

    return {
      page,
      limit,
      hasMore: results.length >= limit,
      _url: `${this.baseUrl}/${this.path}/ids${
        Object.keys(queryParams).length > 0
          ? `?${qsStringify(queryParams)}`
          : ""
      }`,
      _links: {
        ...(results.length >= limit && {
          nextPage: `${this.baseUrl}/${this.path}/ids?${qs.stringify({
            ...queryParams,
            page: page + 1,
          })}`,
        }),
        ...(page !== 0 && {
          previousPage: `${this.baseUrl}/${this.path}/ids?${qs.stringify({
            ...queryParams,
            page: page - 1,
          })}`,
        }),
      },
      items: results,
    };
  }

  async read(
    knex: Knex,
    input: Record<string, any>,
    context: Context,
    { withDeleted = input.withDeleted ?? false }: { withDeleted?: boolean } = {}
  ) {
    let [queryParams, errors] = await this.validateWhere(input, context);

    if (Object.keys(errors).length) throw new BadRequestError(errors);

    queryParams = {
      ...(await this.defaultParams(context, "read")),
      ...queryParams,
    };

    const table = this;
    let { include = [] } = queryParams;

    if (typeof include === "string") include = [include];

    if (table.tenantIdColumnName) {
      const tenantId = queryParams[table.tenantIdColumnName];
      if (!tenantId)
        throw new BadRequestError({
          [table.tenantIdColumnName]: `is required`,
        });
    }

    const includeRelated = async (stmt: Knex.QueryBuilder) => {
      let notFoundIncludes: string[] = [];
      let refCount = 0;

      for (let includeTable of include) {
        let isOne = true;
        let ref: RelatedTable<Context> | undefined = Object.values(
          table.relatedTables.hasOne
        ).find((ref) => ref.name === includeTable);

        if (!ref) {
          isOne = false;
          ref = Object.values(table.relatedTables.hasMany).find(
            (ref) => ref.name === includeTable
          );
        }

        if (!ref) {
          notFoundIncludes.push(includeTable);
          continue;
        }

        const alias =
          ref.table.tableName === table.tableName
            ? `${ref.table.tableName}__self_ref_alias_${refCount++}`
            : ref.table.tableName;

        let subQuery = ref.table.withAlias(alias).query(knex);

        // make sure tenant ids are forwarded to subQueries where possible
        if (table.tenantIdColumnName && ref!.table.tenantIdColumnName) {
          subQuery.where(
            `${alias}.${ref!.table.tenantIdColumnName}`,
            knex.ref(`${table.alias}.${table.tenantIdColumnName}`)
          );
        }

        if (isOne) {
          subQuery
            .where(
              `${alias}.${ref.table.idColumnName}`,
              knex.ref(`${table.alias}.${ref.relation.columnName}`)
            )
            .limit(1);
        } else {
          subQuery
            .where(
              `${alias}.${ref.relation.columnName}`,
              knex.ref(`${table.alias}.${table.idColumnName}`)
            )
            .limit(10);
        }

        const aliasOuter = `${alias}_sub_query`;

        await ref.table.withAlias(alias).applyPolicy(subQuery, context, "read");

        const { bindings, sql } = subQuery.toSQL();

        if (isOne) {
          stmt.select(
            knex.raw(`(select row_to_json(??) from (${sql}) ??) as ??`, [
              aliasOuter,
              ...bindings,
              aliasOuter,
              ref.name,
            ])
          );
        } else {
          stmt.select(
            knex.raw(`array(select row_to_json(??) from (${sql}) ??) as ??`, [
              aliasOuter,
              ...bindings,
              aliasOuter,
              ref.name,
            ])
          );
        }
      }

      for (let eager of notFoundIncludes) {
        const eagerGetter = Object.entries(table.eagerGetters).find(
          ([key]) => key === eager
        );

        if (!eagerGetter) continue;
        const [key, fn] = eagerGetter;

        let eagerStmt = knex.queryBuilder();
        await fn.call(table, eagerStmt, context);
        const { bindings, sql, method } = eagerStmt.toSQL();
        const isPluck = method === "pluck";
        const isOne = isPluck || method === "first";

        const rawSql = isPluck
          ? sql
          : `select row_to_json(i) from (${sql}) as i`;

        if (isOne) {
          stmt.select(knex.raw(`(${rawSql}) as ??`, [...bindings, key]));
        } else {
          stmt.select(knex.raw(`array(${rawSql}) as ??`, [...bindings, key]));
        }
      }
    };

    const stmt = table.query(knex);
    await table.where(stmt, context, { ...queryParams, withDeleted });
    await table.applyPolicy(stmt, context, "read");
    await includeRelated(stmt);

    return { stmt };
  }

  async readOne(
    knex: Knex,
    queryParams: Record<string, any>,
    context: Context
  ) {
    queryParams = {
      ...(await this.defaultParams(context, "read")),
      ...queryParams,
    };

    let { include = [] } = queryParams;

    if (typeof include === "string") include = [include];

    const { stmt } = await this.read(knex, queryParams, context, {
      withDeleted: true,
    });
    const data = await stmt.first();

    if (!data) throw new NotFoundError();

    return await this.processTableRow(queryParams, context, data, include);
  }

  async readMany(
    knex: Knex,
    queryParams: Record<string, any>,
    context: Context
  ) {
    queryParams = {
      ...(await this.defaultParams(context, "read")),
      ...queryParams,
    };

    let { include = [] } = queryParams;

    if (typeof include === "string") include = [include];

    const { stmt } = await this.read(knex, queryParams, context);

    const paginate = async (statement: Knex.QueryBuilder) => {
      const table = this;
      const path = table.path;
      let { sort } = queryParams;
      const page = Number(queryParams.page || 0);
      const limit = Math.max(0, Math.min(250, Number(queryParams.limit) || 50));

      const sorts: { column: string; order: "asc" | "desc" }[] = [];
      if (sort) {
        if (!Array.isArray(sort)) sort = [sort];

        sort.forEach((column: string) => {
          let order = "asc";
          if (column.startsWith("-")) {
            order = "desc";
            column = column.slice(1);
          }

          if (
            column in table.columns! &&
            (order === "asc" || order === "desc")
          ) {
            sorts.push({ column, order });
          }
        });
      }

      if (queryParams.cursor) {
        const cursor = JSON.parse(atob(queryParams.cursor));
        // keyset pagination
        statement.where(function () {
          sorts.forEach((sort, index) => {
            this.orWhere(function () {
              sorts
                .slice(0, index)
                .map(({ column }) =>
                  this.where(
                    `${table.tableName}.${column}`,
                    "=",
                    cursor[column]
                  )
                );
              this.where(
                `${table.tableName}.${sort.column}`,
                sort.order === "asc" ? ">" : "<",
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
        let column = this.defaultSortColumn;
        let order: "asc" | "desc" = "asc";

        if (column.startsWith("-")) {
          order = "desc";
          column = column.slice(1);
        }

        sorts.push({
          column,
          order,
        });

        if (this.defaultSortColumn !== this.idColumnName) {
          sorts.push({
            column: this.idColumnName,
            order: "asc",
          });
        }
      }

      sorts.forEach((s) =>
        statement.orderBy(`${table.alias}.${s.column}`, s.order)
      );

      const results = await statement;

      const links = {
        ...(!queryParams.page
          ? {
              ...(results.length >= limit && {
                nextPage: `${table.baseUrl}/${path}?${qsStringify({
                  ...queryParams,
                  cursor: btoa(JSON.stringify(results[results.length - 1])),
                })}`,
              }),
            }
          : {
              ...(results.length >= limit && {
                nextPage: `${table.baseUrl}/${path}?${qsStringify({
                  ...queryParams,
                  page: page + 1,
                })}`,
              }),
            }),
        count: `${table.baseUrl}/${path}/count${
          Object.keys(queryParams).length > 0 ? "?" : ""
        }${qsStringify(queryParams)}`,
        ids: `${table.baseUrl}/${path}/ids${
          Object.keys(queryParams).length > 0 ? "?" : ""
        }${qsStringify(queryParams)}`,
      };

      const processedResults: any[] = await Promise.all(
        results.map(
          async (item: any) =>
            await this.processTableRow(queryParams, context, item, include)
        )
      );
      return new CollectionResult(processedResults, {
        page,
        limit,
        hasMore: results.length >= limit,
        url: `${table.baseUrl}/${path}${
          Object.keys(queryParams).length > 0
            ? `?${qsStringify(queryParams)}`
            : ""
        }`,
        links: links,
        type: path,
      });
    };

    return paginate(stmt);
  }

  private async fixUpserts(knex: Knex, input: any, context: Context) {
    const obj = { ...input };
    const { hasOne, hasMany } = this.relatedTables;

    for (let [
      key,
      {
        relation: { columnName: column },
        table: otherTable,
      },
    ] of Object.entries(hasOne)) {
      const otherObj = obj[key];
      if (!otherObj) continue;
      if (otherObj[otherTable.idColumnName])
        obj[column] = otherObj[otherTable.idColumnName];
      obj[key] = await otherTable.fixUpserts(knex, otherObj, context);
    }

    for (let [
      key,
      {
        relation: { columnName: column },
        table: otherTable,
      },
    ] of Object.entries(hasMany)) {
      const otherObjs = obj[key];
      if (!otherObjs || !Array.isArray(otherObjs)) continue;

      obj[key] = await Promise.all(
        obj[key].map((otherObj: any) =>
          otherTable.fixUpserts(
            knex,
            {
              ...otherObj,
              [column]: obj[this.idColumnName] || otherObj[column],
            },
            context
          )
        )
      );
    }

    if (
      !this.allowUpserts ||
      obj._delete ||
      obj[this.idColumnName] ||
      !this.uniqueColumns.every((columns) =>
        columns.every((column) => obj[column] != null)
      )
    ) {
      return obj;
    }

    // if there is a row, see if we can upsert to it
    for (let columns of this.uniqueColumns) {
      const upsertCheckStmt = this.query(knex);

      if (this.tenantIdColumnName && obj[this.tenantIdColumnName]) {
        upsertCheckStmt.where(
          `${this.alias}.${this.tenantIdColumnName}`,
          obj[this.tenantIdColumnName]
        );
      }

      for (let column of columns) {
        upsertCheckStmt.where(`${this.alias}.${column}`, obj[column]);
      }

      this.applyPolicy(upsertCheckStmt, context, "update");

      const visibleConflict = await upsertCheckStmt.first();

      if (visibleConflict) {
        return {
          ...visibleConflict,
          ...obj,
        };
      }
    }

    return obj;
  }

  async write(knex: Knex, obj: T, context: Context) {
    obj = await this.fixUpserts(knex, obj, context);
    const [objValidated, errors] = await this.validateDeep(knex, obj, context);
    obj = objValidated;

    if (errors) {
      throw new BadRequestError(errors);
    }

    const beforeCommitCallbacks: (() => Promise<void>)[] = [];
    const changes: ChangeSummary<T>[] = [];
    const uuid = uuidv4();

    let trxRef: null | Knex.Transaction = null;

    const data = await knex.transaction(async (trx) => {
      // Needs to emit commit after this function finishes
      trxRef = trx;

      const result = await this.updateDeep(
        trx,
        obj,
        context,
        beforeCommitCallbacks,
        changes
      );
      for (let cb of beforeCommitCallbacks) await cb();

      return result;
    });

    trxRef!.emit("commit");

    if (this.eventEmitter)
      this.eventEmitter.emit("change", { id: uuid, changes });

    return new ChangeResult(uuid, data, changes);
  }
}
