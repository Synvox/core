import { EventEmitter } from "events";
import { Request, Response, Router } from "express";
import { Knex } from "knex";
import { mixed, object, BaseSchema } from "yup";
import { Table } from "./Table";

export type RelationDef = {
  schemaName?: string;
  tableName?: string;
  columnName: string;
  referencesSchema?: string;
  referencesTable: string;
  referencesColumnName?: string;
  deleteRule?: string;
  updateRule?: string;
};

export class Relation {
  schemaName: string;
  tableName: string;
  columnName: string;
  referencesSchema: string;
  referencesTable: string;
  referencesColumnName: string;
  deleteRule: string;
  updateRule: string;
  constructor(def: RelationDef) {
    this.schemaName = def.schemaName ?? "public";
    this.tableName = def.tableName ?? "";
    this.columnName = def.columnName;
    this.referencesSchema = def.referencesSchema ?? "public";
    this.referencesTable = def.referencesTable;
    this.referencesColumnName = def.referencesColumnName ?? "id";
    this.deleteRule = def.deleteRule ?? "NO ACTION";
    this.updateRule = def.updateRule ?? "NO ACTION";
  }
}

export type ShouldEventBeSent<Context, T> = (
  isVisible: () => Promise<boolean>,
  event: ChangeSummary<T>,
  context: Context
) => Promise<boolean>;

export type ChangeSummary<T> = {
  mode: Mode;
  path: string;
  row: T;
};

export type ContextFactory<Context> = (req: Request, res: Response) => Context;

export type Mixed = ReturnType<typeof mixed>;
export type ObjectSchema = ReturnType<typeof object>;

export type Mode = "insert" | "read" | "update" | "delete";

export type Policy<Context> = (
  this: Table<Context>,
  query: Knex.QueryBuilder,
  context: Context,
  mode: Mode,
  knex: Knex
) => Promise<void>;

export type YupSchema = { [columnName: string]: BaseSchema };

export type IdModifier<Context> = (
  this: Table<Context>,
  query: Knex.QueryBuilder,
  context: Context
) => Promise<void>;

export type IdModifiers<Context> = Record<string, IdModifier<Context>>;

export type QueryModifier<Context> = (
  this: Table<Context>,
  value: any,
  query: Knex.QueryBuilder,
  context: Context
) => Promise<void>;
export type QueryModifiers<Context> = Record<string, QueryModifier<Context>>;

export type Setter<Context> = (
  trx: Knex.Transaction,
  value: any,
  row: any,
  context: Context
) => Promise<void>;

export type Setters<Context> = Record<string, Setter<Context>>;

export type EagerGetter<Context> = (
  this: Table<Context>,
  stmt: Knex.QueryBuilder,
  context: Context
) => Promise<void>;

export type EagerGetters<Context> = Record<string, EagerGetter<Context>>;

export type Getter<Context> = (row: any, context: Context) => Promise<any>;

export type Getters<Context> = Record<string, Getter<Context>>;

export type BeforeUpdate<Context> = (
  this: Table<Context>,
  trx: Knex.Transaction,
  context: ReturnType<ContextFactory<Context>>,
  mode: "insert" | "update" | "delete",
  draft: any,
  current: any
) => Promise<void>;

export type AfterUpdate<Context> = (
  this: Table<Context>,
  trx: Knex.Transaction,
  context: ReturnType<ContextFactory<Context>>,
  mode: "insert" | "update" | "delete",
  next: any,
  previous: any
) => Promise<void>;

export type Column = {
  name: string;
  type: string;
  nullable: boolean;
  defaultValue: string | null;
  length: number;
};

export type Columns = Record<string, Column>;

export type Relations = Record<string, Relation>;

export type RelatedTable<Context> = {
  name: string;
  relation: Relation;
  table: Table<Context>;
};

export type RelatedTables<Context> = Record<string, RelatedTable<Context>>;

export type TableDef<T> = { tableName: string } & Partial<{
  schemaName: string;
  tenantIdColumnName: string | null;
  idColumnName: string;
  policy: Policy<T>;
  schema: YupSchema;
  path: string;
  readOnlyColumns: string[];
  hiddenColumns: string[];
  paranoid: boolean;
  router: Router;
  idModifiers: IdModifiers<T>;
  queryModifiers: QueryModifiers<T>;
  setters: Setters<T>;
  eagerGetters: EagerGetters<T>;
  getters: Getters<T>;
  inverseOfColumnName: Record<string, string>;
  beforeUpdate: BeforeUpdate<T>;
  afterUpdate: AfterUpdate<T>;
  baseUrl: string;
  forwardQueryParams: string[];
  columns: Columns;
  uniqueColumns: string[][];
  relations: Relations;
  idGenerator?: () => any;
  eventEmitter?: EventEmitter;
  defaultParams?: (
    context: T,
    mode: Omit<Mode, "delete">
  ) => Promise<Partial<any>>;
  enforcedParams?: (
    context: T,
    mode: Omit<Mode, "delete" | "read">
  ) => Promise<Partial<any>>;
  allowUpserts?: boolean;
  complexityLimit?: number;
  eagerLoadingComplexityLimit?: number;
  complexityWeight?: number;
  defaultSortColumn: string;
  methods: Methods<T>;
  staticMethods: StaticMethods<T>;
  isLookupTable: boolean;
  maxBulkUpdates?: number;
}>;

export type KnexGetter = (mode: "read" | "write" | "schema") => Promise<Knex>;

export type Method<Context> = (
  row: any,
  body: any,
  context: Context
) => Promise<any>;

export type Methods<Context> = Record<string, Method<Context>>;

export type StaticMethod<Context> = (
  body: any,
  context: Context
) => Promise<any>;

export type StaticMethods<Context> = Record<string, StaticMethod<Context>>;
