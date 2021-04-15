import Path from "path";
import Knex from "knex";
import { createServer } from "http";
import { promises as fs } from "fs";
import testListen from "test-listen";
import express, { Application } from "express";
import Axios from "axios";
import { knexHelpers, Core } from "../src";
import uuid from "uuid";

let queries: string[] = [];
let server: null | ReturnType<typeof createServer> = null;

async function listen(app: Application) {
  if (server) {
    server?.close();
    server = null;
  }

  server = createServer(app);
  const url = await testListen(server);

  return url;
}

const knex = Knex({
  client: "pg",
  connection: {
    database: process.env.USER,
  },
  ...knexHelpers,
  debug: true,
  log: {
    debug: (message: { sql: string }) => {
      queries.push(message.sql);
    },
  },
  pool: {
    afterCreate: function (conn: any, done: any) {
      conn.query("SET TIME ZONE -6;", function (err: any) {
        done(err, conn);
      });
    },
  },
});

beforeEach(async () => {
  await knex.raw(`
    drop schema if exists save_test cascade;
    create schema save_test;
  `);

  const anonymousId = "uuid-test-value";
  jest.spyOn(uuid, "v4").mockReturnValue(anonymousId);
});

afterEach(() => {
  queries = [];
  if (server) {
    server?.close();
    server = null;
  }
});

afterAll(async () => {
  await knex.destroy();
});

describe("saves to files", () => {
  beforeEach(async () => {
    await knex.schema.withSchema("saveTest").createTable("types", (t) => {
      t.text("id").primary();
    });
    await knex("saveTest.types").insert([
      { id: "type1" },
      { id: "type2" },
      { id: "type3" },
    ]);
    await knex.schema.withSchema("saveTest").createTable("test", (t) => {
      t.bigIncrements("id").primary();
      t.boolean("is_boolean").notNullable().defaultTo(false);
      t.integer("number_count").notNullable().defaultTo(0);
      t.specificType("text", "character varying(10)")
        .notNullable()
        .defaultTo("text");
      t.text("type_id")
        .references("id")
        .inTable("save_test.types")
        .notNullable();
    });
    await knex.schema.withSchema("saveTest").createTable("test_sub", (t) => {
      t.bigIncrements("id").primary();
      t.bigInteger("parent_id")
        .references("id")
        .inTable("save_test.test")
        .notNullable();
      t.specificType("arr", "int[]");
    });
    await knex.schema
      .withSchema("saveTest")
      .createTable("test_nullable", (t) => {
        t.bigIncrements("id").primary();
        t.boolean("is_boolean").notNullable().defaultTo(false);
        t.integer("number_count").notNullable().defaultTo(0);
        t.specificType("text", "character varying(10)")
          .notNullable()
          .defaultTo("text");
      });
    await knex.schema
      .withSchema("saveTest")
      .createTable("test_sub_nullable", (t) => {
        t.bigIncrements("id").primary();
        t.bigInteger("parent_id").references("id").inTable("save_test.test");
        t.specificType("arr", "int[]");
      });
  });

  it("saves and restores schema from file", async () => {
    const path = Path.resolve(__dirname, "./test.ignore.json");

    {
      const core = new Core(knex, () => ({}), {
        schemaFilePath: path,
      });

      core.table({
        schemaName: "saveTest",
        tableName: "test",
      });

      core.table({
        schemaName: "saveTest",
        tableName: "testSub",
      });

      const app = express();
      app.use(core.router);
      const url = await listen(app);

      const axios = Axios.create({ baseURL: url });

      await axios.get("/saveTest/test");
      const json = JSON.parse(await fs.readFile(path, { encoding: "utf8" }));
      expect(json).toMatchInlineSnapshot(`
        Object {
          "saveTest.test": Object {
            "columns": Object {
              "id": Object {
                "defaultValue": "nextval('save_test.test_id_seq'::regclass)",
                "length": -1,
                "name": "id",
                "nullable": false,
                "type": "bigint",
              },
              "isBoolean": Object {
                "defaultValue": "false",
                "length": -1,
                "name": "isBoolean",
                "nullable": false,
                "type": "boolean",
              },
              "numberCount": Object {
                "defaultValue": "0",
                "length": -1,
                "name": "numberCount",
                "nullable": false,
                "type": "integer",
              },
              "text": Object {
                "defaultValue": "'text'::character varying",
                "length": 10,
                "name": "text",
                "nullable": false,
                "type": "character varying",
              },
              "typeId": Object {
                "defaultValue": null,
                "length": -1,
                "name": "typeId",
                "nullable": false,
                "type": "text",
              },
            },
            "relations": Object {
              "typeId": Object {
                "columnName": "typeId",
                "deleteRule": "NO ACTION",
                "referencesColumnName": "id",
                "referencesSchema": "saveTest",
                "referencesTable": "types",
                "schemaName": "save_test",
                "tableName": "test",
                "updateRule": "NO ACTION",
              },
            },
            "uniqueColumns": Array [],
          },
          "saveTest.testSub": Object {
            "columns": Object {
              "arr": Object {
                "defaultValue": null,
                "length": -1,
                "name": "arr",
                "nullable": true,
                "type": "integer[]",
              },
              "id": Object {
                "defaultValue": "nextval('save_test.test_sub_id_seq'::regclass)",
                "length": -1,
                "name": "id",
                "nullable": false,
                "type": "bigint",
              },
              "parentId": Object {
                "defaultValue": null,
                "length": -1,
                "name": "parentId",
                "nullable": false,
                "type": "bigint",
              },
            },
            "relations": Object {
              "parentId": Object {
                "columnName": "parentId",
                "deleteRule": "NO ACTION",
                "referencesColumnName": "id",
                "referencesSchema": "saveTest",
                "referencesTable": "test",
                "schemaName": "save_test",
                "tableName": "test_sub",
                "updateRule": "NO ACTION",
              },
            },
            "uniqueColumns": Array [],
          },
        }
      `);
    }

    {
      const core = new Core(knex, () => ({}), {
        schemaFilePath: path,
        loadSchemaFromFile: true,
      });

      core.table({
        schemaName: "saveTest",
        tableName: "test",
      });

      core.table({
        schemaName: "saveTest",
        tableName: "testSub",
      });

      const app = express();
      app.use(core.router);
      const url = await listen(app);

      const axios = Axios.create({ baseURL: url });

      queries = [];
      await axios.get("/saveTest/test");
      expect(queries).toMatchInlineSnapshot(`
        Array [
          "select test.id, test.is_boolean, test.number_count, test.text, test.type_id from save_test.test order by test.id asc limit ?",
        ]
      `);
    }
  });

  it("saves types", async () => {
    const path = Path.resolve(__dirname, "./test.ignore1.ts");

    const core = new Core(knex, () => ({}));

    core.table({
      schemaName: "saveTest",
      tableName: "test",
    });

    core.table({
      schemaName: "saveTest",
      tableName: "testSub",
    });

    core.table({
      schemaName: "saveTest",
      tableName: "testNullable",
    });

    core.table({
      schemaName: "saveTest",
      tableName: "testSubNullable",
    });

    await core.saveTsTypes(path);

    const types = await fs.readFile(path, { encoding: "utf8" });
    expect(types).toMatchInlineSnapshot(`
      "export type Test = {
        id: number;
        isBoolean: boolean;
        numberCount: number;
        text: string;
        typeId: string;
        _url: string;
        _type: string;
        _links: {
          testSub: string;
          testSubNullable: string;
        };
      };

      export type TestNullable = {
        id: number;
        isBoolean: boolean;
        numberCount: number;
        text: string;
        _url: string;
        _type: string;
        _links: {
        };
      };

      export type TestSub = {
        id: number;
        parentId: number;
        arr: number[] | null;
        _url: string;
        _type: string;
        _links: {
          parent: string;
        };
      };

      export type TestSubNullable = {
        id: number;
        parentId: number | null;
        arr: number[] | null;
        _url: string;
        _type: string;
        _links: {
          parent?: string;
        };
      };
      "
    `);
  });

  it("saves types without links", async () => {
    const path = Path.resolve(__dirname, "./test.ignore2.ts");

    const core = new Core(knex, () => ({}));

    core.table({
      schemaName: "saveTest",
      tableName: "test",
    });

    core.table({
      schemaName: "saveTest",
      tableName: "testSub",
    });

    core.table({
      schemaName: "saveTest",
      tableName: "testNullable",
    });

    core.table({
      schemaName: "saveTest",
      tableName: "testSubNullable",
    });

    await core.saveTsTypes(path, { includeLinks: false });

    const types = await fs.readFile(path, { encoding: "utf8" });
    expect(types).toMatchInlineSnapshot(`
      "export type Test = {
        id: number;
        isBoolean: boolean;
        numberCount: number;
        text: string;
        typeId: string;
      };

      export type TestNullable = {
        id: number;
        isBoolean: boolean;
        numberCount: number;
        text: string;
      };

      export type TestSub = {
        id: number;
        parentId: number;
        arr: number[] | null;
      };

      export type TestSubNullable = {
        id: number;
        parentId: number | null;
        arr: number[] | null;
      };
      "
    `);
  });

  it("saves types with relations", async () => {
    const path = Path.resolve(__dirname, "./test.ignore3.ts");

    const core = new Core(knex, () => ({}));

    core.table({
      schemaName: "saveTest",
      tableName: "test",
    });

    core.table({
      schemaName: "saveTest",
      tableName: "testSub",
    });

    core.table({
      schemaName: "saveTest",
      tableName: "testNullable",
    });

    core.table({
      schemaName: "saveTest",
      tableName: "testSubNullable",
    });

    await core.saveTsTypes(path, {
      includeRelations: true,
      includeLinks: false,
    });

    const types = await fs.readFile(path, { encoding: "utf8" });
    expect(types).toMatchInlineSnapshot(`
      "export type Test = {
        id: number;
        isBoolean: boolean;
        numberCount: number;
        text: string;
        typeId: string;
        testSub: TestSub[];
        testSubNullable: TestSubNullable[];
      };

      export type TestNullable = {
        id: number;
        isBoolean: boolean;
        numberCount: number;
        text: string;
      };

      export type TestSub = {
        id: number;
        parentId: number;
        arr: number[] | null;
        parent: Test;
      };

      export type TestSubNullable = {
        id: number;
        parentId: number | null;
        arr: number[] | null;
        parent?: Test;
      };
      "
    `);
  });

  it("saves types with relations and params", async () => {
    const path = Path.resolve(__dirname, "./test.ignore4.ts");

    const core = new Core(knex, () => ({}));

    core.table({
      schemaName: "saveTest",
      tableName: "test",
    });

    core.table({
      schemaName: "saveTest",
      tableName: "testSub",
      queryModifiers: {
        async thing() {},
      },
    });

    core.table({
      schemaName: "saveTest",
      tableName: "testNullable",
      idModifiers: {
        async me() {},
      },
    });

    core.table({
      schemaName: "saveTest",
      tableName: "testSubNullable",
    });

    await core.saveTsTypes(path, {
      includeRelations: true,
      includeLinks: false,
      includeParams: true,
    });

    const types = await fs.readFile(path, { encoding: "utf8" });
    expect(types).toMatchInlineSnapshot(`
      "export type Test = {
        id: number;
        isBoolean: boolean;
        numberCount: number;
        text: string;
        typeId: string;
        testSub: TestSub[];
        testSubNullable: TestSubNullable[];
      };

      export type TestParams = Partial<{
        id: number | number[];
        id.not: number | number[];
        \\"id.eq\\": number | number[];
        \\"id.not.eq\\": number | number[];
        \\"id.neq\\": number | number[];
        \\"id.not.neq\\": number | number[];
        \\"id.lt\\": number | number[];
        \\"id.not.lt\\": number | number[];
        \\"id.lte\\": number | number[];
        \\"id.not.lte\\": number | number[];
        \\"id.gt\\": number | number[];
        \\"id.not.gt\\": number | number[];
        \\"id.gte\\": number | number[];
        \\"id.not.gte\\": number | number[];
        isBoolean: boolean | boolean[];
        isBoolean.not: boolean | boolean[];
        \\"isBoolean.eq\\": boolean | boolean[];
        \\"isBoolean.not.eq\\": boolean | boolean[];
        \\"isBoolean.neq\\": boolean | boolean[];
        \\"isBoolean.not.neq\\": boolean | boolean[];
        \\"isBoolean.lt\\": boolean | boolean[];
        \\"isBoolean.not.lt\\": boolean | boolean[];
        \\"isBoolean.lte\\": boolean | boolean[];
        \\"isBoolean.not.lte\\": boolean | boolean[];
        \\"isBoolean.gt\\": boolean | boolean[];
        \\"isBoolean.not.gt\\": boolean | boolean[];
        \\"isBoolean.gte\\": boolean | boolean[];
        \\"isBoolean.not.gte\\": boolean | boolean[];
        numberCount: number | number[];
        numberCount.not: number | number[];
        \\"numberCount.eq\\": number | number[];
        \\"numberCount.not.eq\\": number | number[];
        \\"numberCount.neq\\": number | number[];
        \\"numberCount.not.neq\\": number | number[];
        \\"numberCount.lt\\": number | number[];
        \\"numberCount.not.lt\\": number | number[];
        \\"numberCount.lte\\": number | number[];
        \\"numberCount.not.lte\\": number | number[];
        \\"numberCount.gt\\": number | number[];
        \\"numberCount.not.gt\\": number | number[];
        \\"numberCount.gte\\": number | number[];
        \\"numberCount.not.gte\\": number | number[];
        text: string | string[];
        text.not: string | string[];
        \\"text.eq\\": string | string[];
        \\"text.not.eq\\": string | string[];
        \\"text.neq\\": string | string[];
        \\"text.not.neq\\": string | string[];
        \\"text.lt\\": string | string[];
        \\"text.not.lt\\": string | string[];
        \\"text.lte\\": string | string[];
        \\"text.not.lte\\": string | string[];
        \\"text.gt\\": string | string[];
        \\"text.not.gt\\": string | string[];
        \\"text.gte\\": string | string[];
        \\"text.not.gte\\": string | string[];
        \\"text.fts\\": string;
        \\"text.not.fts\\": string;
        typeId: string | string[];
        typeId.not: string | string[];
        \\"typeId.eq\\": string | string[];
        \\"typeId.not.eq\\": string | string[];
        \\"typeId.neq\\": string | string[];
        \\"typeId.not.neq\\": string | string[];
        \\"typeId.lt\\": string | string[];
        \\"typeId.not.lt\\": string | string[];
        \\"typeId.lte\\": string | string[];
        \\"typeId.not.lte\\": string | string[];
        \\"typeId.gt\\": string | string[];
        \\"typeId.not.gt\\": string | string[];
        \\"typeId.gte\\": string | string[];
        \\"typeId.not.gte\\": string | string[];
        \\"typeId.fts\\": string;
        \\"typeId.not.fts\\": string;
        and: Omit<TestParams, \\"include\\" | \\"cursor\\" | \\"page\\" | \\"limit\\"> | Omit<TestParams, \\"include\\" | \\"cursor\\" | \\"page\\" | \\"limit\\">[];
        not.and: Omit<TestParams, \\"include\\" | \\"cursor\\" | \\"page\\" | \\"limit\\"> | Omit<TestParams, \\"include\\" | \\"cursor\\" | \\"page\\" | \\"limit\\">[];
        or: Omit<TestParams, \\"include\\" | \\"cursor\\" | \\"page\\" | \\"limit\\"> | Omit<TestParams, \\"include\\" | \\"cursor\\" | \\"page\\" | \\"limit\\">[];
        not.or: Omit<TestParams, \\"include\\" | \\"cursor\\" | \\"page\\" | \\"limit\\"> | Omit<TestParams, \\"include\\" | \\"cursor\\" | \\"page\\" | \\"limit\\">[];
        cursor: string;
        page: number;
        limit: number;
        include: ('testSub' | 'testSubNullable')[];
      }>;

      export type TestNullable = {
        id: number;
        isBoolean: boolean;
        numberCount: number;
        text: string;
      };

      export type TestNullableParams = Partial<{
        id: number | number[] | \\"me\\";
        id.not: number | number[] | \\"me\\";
        \\"id.eq\\": number | number[];
        \\"id.not.eq\\": number | number[];
        \\"id.neq\\": number | number[];
        \\"id.not.neq\\": number | number[];
        \\"id.lt\\": number | number[];
        \\"id.not.lt\\": number | number[];
        \\"id.lte\\": number | number[];
        \\"id.not.lte\\": number | number[];
        \\"id.gt\\": number | number[];
        \\"id.not.gt\\": number | number[];
        \\"id.gte\\": number | number[];
        \\"id.not.gte\\": number | number[];
        isBoolean: boolean | boolean[];
        isBoolean.not: boolean | boolean[];
        \\"isBoolean.eq\\": boolean | boolean[];
        \\"isBoolean.not.eq\\": boolean | boolean[];
        \\"isBoolean.neq\\": boolean | boolean[];
        \\"isBoolean.not.neq\\": boolean | boolean[];
        \\"isBoolean.lt\\": boolean | boolean[];
        \\"isBoolean.not.lt\\": boolean | boolean[];
        \\"isBoolean.lte\\": boolean | boolean[];
        \\"isBoolean.not.lte\\": boolean | boolean[];
        \\"isBoolean.gt\\": boolean | boolean[];
        \\"isBoolean.not.gt\\": boolean | boolean[];
        \\"isBoolean.gte\\": boolean | boolean[];
        \\"isBoolean.not.gte\\": boolean | boolean[];
        numberCount: number | number[];
        numberCount.not: number | number[];
        \\"numberCount.eq\\": number | number[];
        \\"numberCount.not.eq\\": number | number[];
        \\"numberCount.neq\\": number | number[];
        \\"numberCount.not.neq\\": number | number[];
        \\"numberCount.lt\\": number | number[];
        \\"numberCount.not.lt\\": number | number[];
        \\"numberCount.lte\\": number | number[];
        \\"numberCount.not.lte\\": number | number[];
        \\"numberCount.gt\\": number | number[];
        \\"numberCount.not.gt\\": number | number[];
        \\"numberCount.gte\\": number | number[];
        \\"numberCount.not.gte\\": number | number[];
        text: string | string[];
        text.not: string | string[];
        \\"text.eq\\": string | string[];
        \\"text.not.eq\\": string | string[];
        \\"text.neq\\": string | string[];
        \\"text.not.neq\\": string | string[];
        \\"text.lt\\": string | string[];
        \\"text.not.lt\\": string | string[];
        \\"text.lte\\": string | string[];
        \\"text.not.lte\\": string | string[];
        \\"text.gt\\": string | string[];
        \\"text.not.gt\\": string | string[];
        \\"text.gte\\": string | string[];
        \\"text.not.gte\\": string | string[];
        \\"text.fts\\": string;
        \\"text.not.fts\\": string;
        and: Omit<TestNullableParams, \\"include\\" | \\"cursor\\" | \\"page\\" | \\"limit\\"> | Omit<TestNullableParams, \\"include\\" | \\"cursor\\" | \\"page\\" | \\"limit\\">[];
        not.and: Omit<TestNullableParams, \\"include\\" | \\"cursor\\" | \\"page\\" | \\"limit\\"> | Omit<TestNullableParams, \\"include\\" | \\"cursor\\" | \\"page\\" | \\"limit\\">[];
        or: Omit<TestNullableParams, \\"include\\" | \\"cursor\\" | \\"page\\" | \\"limit\\"> | Omit<TestNullableParams, \\"include\\" | \\"cursor\\" | \\"page\\" | \\"limit\\">[];
        not.or: Omit<TestNullableParams, \\"include\\" | \\"cursor\\" | \\"page\\" | \\"limit\\"> | Omit<TestNullableParams, \\"include\\" | \\"cursor\\" | \\"page\\" | \\"limit\\">[];
        cursor: string;
        page: number;
        limit: number;
      }>;

      export type TestSub = {
        id: number;
        parentId: number;
        arr: number[] | null;
        parent: Test;
      };

      export type TestSubParams = Partial<{
        id: number | number[];
        id.not: number | number[];
        \\"id.eq\\": number | number[];
        \\"id.not.eq\\": number | number[];
        \\"id.neq\\": number | number[];
        \\"id.not.neq\\": number | number[];
        \\"id.lt\\": number | number[];
        \\"id.not.lt\\": number | number[];
        \\"id.lte\\": number | number[];
        \\"id.not.lte\\": number | number[];
        \\"id.gt\\": number | number[];
        \\"id.not.gt\\": number | number[];
        \\"id.gte\\": number | number[];
        \\"id.not.gte\\": number | number[];
        parentId: number | number[];
        parentId.not: number | number[];
        \\"parentId.eq\\": number | number[];
        \\"parentId.not.eq\\": number | number[];
        \\"parentId.neq\\": number | number[];
        \\"parentId.not.neq\\": number | number[];
        \\"parentId.lt\\": number | number[];
        \\"parentId.not.lt\\": number | number[];
        \\"parentId.lte\\": number | number[];
        \\"parentId.not.lte\\": number | number[];
        \\"parentId.gt\\": number | number[];
        \\"parentId.not.gt\\": number | number[];
        \\"parentId.gte\\": number | number[];
        \\"parentId.not.gte\\": number | number[];
        arr: number[] | null;
        arr.not: number[] | null;
        \\"arr.eq\\": number[] | null;
        \\"arr.not.eq\\": number[] | null;
        \\"arr.neq\\": number[] | null;
        \\"arr.not.neq\\": number[] | null;
        \\"arr.lt\\": number[] | null;
        \\"arr.not.lt\\": number[] | null;
        \\"arr.lte\\": number[] | null;
        \\"arr.not.lte\\": number[] | null;
        \\"arr.gt\\": number[] | null;
        \\"arr.not.gt\\": number[] | null;
        \\"arr.gte\\": number[] | null;
        \\"arr.not.gte\\": number[] | null;
        arr.null: any;
        arr.not.null: any;
        thing: unknown;
        and: Omit<TestSubParams, \\"include\\" | \\"cursor\\" | \\"page\\" | \\"limit\\" | \\"thing\\"> | Omit<TestSubParams, \\"include\\" | \\"cursor\\" | \\"page\\" | \\"limit\\" | \\"thing\\">[];
        not.and: Omit<TestSubParams, \\"include\\" | \\"cursor\\" | \\"page\\" | \\"limit\\" | \\"thing\\"> | Omit<TestSubParams, \\"include\\" | \\"cursor\\" | \\"page\\" | \\"limit\\" | \\"thing\\">[];
        or: Omit<TestSubParams, \\"include\\" | \\"cursor\\" | \\"page\\" | \\"limit\\" | \\"thing\\"> | Omit<TestSubParams, \\"include\\" | \\"cursor\\" | \\"page\\" | \\"limit\\" | \\"thing\\">[];
        not.or: Omit<TestSubParams, \\"include\\" | \\"cursor\\" | \\"page\\" | \\"limit\\" | \\"thing\\"> | Omit<TestSubParams, \\"include\\" | \\"cursor\\" | \\"page\\" | \\"limit\\" | \\"thing\\">[];
        cursor: string;
        page: number;
        limit: number;
        include: ('parent')[];
      }>;

      export type TestSubNullable = {
        id: number;
        parentId: number | null;
        arr: number[] | null;
        parent?: Test;
      };

      export type TestSubNullableParams = Partial<{
        id: number | number[];
        id.not: number | number[];
        \\"id.eq\\": number | number[];
        \\"id.not.eq\\": number | number[];
        \\"id.neq\\": number | number[];
        \\"id.not.neq\\": number | number[];
        \\"id.lt\\": number | number[];
        \\"id.not.lt\\": number | number[];
        \\"id.lte\\": number | number[];
        \\"id.not.lte\\": number | number[];
        \\"id.gt\\": number | number[];
        \\"id.not.gt\\": number | number[];
        \\"id.gte\\": number | number[];
        \\"id.not.gte\\": number | number[];
        parentId: number | number[] | null;
        parentId.not: number | number[] | null;
        \\"parentId.eq\\": number | number[] | null;
        \\"parentId.not.eq\\": number | number[] | null;
        \\"parentId.neq\\": number | number[] | null;
        \\"parentId.not.neq\\": number | number[] | null;
        \\"parentId.lt\\": number | number[] | null;
        \\"parentId.not.lt\\": number | number[] | null;
        \\"parentId.lte\\": number | number[] | null;
        \\"parentId.not.lte\\": number | number[] | null;
        \\"parentId.gt\\": number | number[] | null;
        \\"parentId.not.gt\\": number | number[] | null;
        \\"parentId.gte\\": number | number[] | null;
        \\"parentId.not.gte\\": number | number[] | null;
        parentId.null: any;
        parentId.not.null: any;
        arr: number[] | null;
        arr.not: number[] | null;
        \\"arr.eq\\": number[] | null;
        \\"arr.not.eq\\": number[] | null;
        \\"arr.neq\\": number[] | null;
        \\"arr.not.neq\\": number[] | null;
        \\"arr.lt\\": number[] | null;
        \\"arr.not.lt\\": number[] | null;
        \\"arr.lte\\": number[] | null;
        \\"arr.not.lte\\": number[] | null;
        \\"arr.gt\\": number[] | null;
        \\"arr.not.gt\\": number[] | null;
        \\"arr.gte\\": number[] | null;
        \\"arr.not.gte\\": number[] | null;
        arr.null: any;
        arr.not.null: any;
        and: Omit<TestSubNullableParams, \\"include\\" | \\"cursor\\" | \\"page\\" | \\"limit\\"> | Omit<TestSubNullableParams, \\"include\\" | \\"cursor\\" | \\"page\\" | \\"limit\\">[];
        not.and: Omit<TestSubNullableParams, \\"include\\" | \\"cursor\\" | \\"page\\" | \\"limit\\"> | Omit<TestSubNullableParams, \\"include\\" | \\"cursor\\" | \\"page\\" | \\"limit\\">[];
        or: Omit<TestSubNullableParams, \\"include\\" | \\"cursor\\" | \\"page\\" | \\"limit\\"> | Omit<TestSubNullableParams, \\"include\\" | \\"cursor\\" | \\"page\\" | \\"limit\\">[];
        not.or: Omit<TestSubNullableParams, \\"include\\" | \\"cursor\\" | \\"page\\" | \\"limit\\"> | Omit<TestSubNullableParams, \\"include\\" | \\"cursor\\" | \\"page\\" | \\"limit\\">[];
        cursor: string;
        page: number;
        limit: number;
        include: ('parent')[];
      }>;
      "
    `);
  });

  it("adds getters to types", async () => {
    const path = Path.resolve(__dirname, "./test.ignore5.ts");

    const core = new Core(knex, () => ({}));

    core.table({
      schemaName: "saveTest",
      tableName: "test",
      getters: {
        async getThing() {
          return null;
        },
      },
      eagerGetters: {
        async getOtherThing() {},
      },
    });

    await core.saveTsTypes(path, {
      includeRelations: true,
      includeLinks: false,
      includeParams: true,
    });

    const types = await fs.readFile(path, { encoding: "utf8" });
    expect(types).toMatchInlineSnapshot(`
      "export type Test = {
        id: number;
        isBoolean: boolean;
        numberCount: number;
        text: string;
        typeId: string;
        getOtherThing: unknown;
        getThing: unknown;
      };

      export type TestParams = Partial<{
        id: number | number[];
        id.not: number | number[];
        \\"id.eq\\": number | number[];
        \\"id.not.eq\\": number | number[];
        \\"id.neq\\": number | number[];
        \\"id.not.neq\\": number | number[];
        \\"id.lt\\": number | number[];
        \\"id.not.lt\\": number | number[];
        \\"id.lte\\": number | number[];
        \\"id.not.lte\\": number | number[];
        \\"id.gt\\": number | number[];
        \\"id.not.gt\\": number | number[];
        \\"id.gte\\": number | number[];
        \\"id.not.gte\\": number | number[];
        isBoolean: boolean | boolean[];
        isBoolean.not: boolean | boolean[];
        \\"isBoolean.eq\\": boolean | boolean[];
        \\"isBoolean.not.eq\\": boolean | boolean[];
        \\"isBoolean.neq\\": boolean | boolean[];
        \\"isBoolean.not.neq\\": boolean | boolean[];
        \\"isBoolean.lt\\": boolean | boolean[];
        \\"isBoolean.not.lt\\": boolean | boolean[];
        \\"isBoolean.lte\\": boolean | boolean[];
        \\"isBoolean.not.lte\\": boolean | boolean[];
        \\"isBoolean.gt\\": boolean | boolean[];
        \\"isBoolean.not.gt\\": boolean | boolean[];
        \\"isBoolean.gte\\": boolean | boolean[];
        \\"isBoolean.not.gte\\": boolean | boolean[];
        numberCount: number | number[];
        numberCount.not: number | number[];
        \\"numberCount.eq\\": number | number[];
        \\"numberCount.not.eq\\": number | number[];
        \\"numberCount.neq\\": number | number[];
        \\"numberCount.not.neq\\": number | number[];
        \\"numberCount.lt\\": number | number[];
        \\"numberCount.not.lt\\": number | number[];
        \\"numberCount.lte\\": number | number[];
        \\"numberCount.not.lte\\": number | number[];
        \\"numberCount.gt\\": number | number[];
        \\"numberCount.not.gt\\": number | number[];
        \\"numberCount.gte\\": number | number[];
        \\"numberCount.not.gte\\": number | number[];
        text: string | string[];
        text.not: string | string[];
        \\"text.eq\\": string | string[];
        \\"text.not.eq\\": string | string[];
        \\"text.neq\\": string | string[];
        \\"text.not.neq\\": string | string[];
        \\"text.lt\\": string | string[];
        \\"text.not.lt\\": string | string[];
        \\"text.lte\\": string | string[];
        \\"text.not.lte\\": string | string[];
        \\"text.gt\\": string | string[];
        \\"text.not.gt\\": string | string[];
        \\"text.gte\\": string | string[];
        \\"text.not.gte\\": string | string[];
        \\"text.fts\\": string;
        \\"text.not.fts\\": string;
        typeId: string | string[];
        typeId.not: string | string[];
        \\"typeId.eq\\": string | string[];
        \\"typeId.not.eq\\": string | string[];
        \\"typeId.neq\\": string | string[];
        \\"typeId.not.neq\\": string | string[];
        \\"typeId.lt\\": string | string[];
        \\"typeId.not.lt\\": string | string[];
        \\"typeId.lte\\": string | string[];
        \\"typeId.not.lte\\": string | string[];
        \\"typeId.gt\\": string | string[];
        \\"typeId.not.gt\\": string | string[];
        \\"typeId.gte\\": string | string[];
        \\"typeId.not.gte\\": string | string[];
        \\"typeId.fts\\": string;
        \\"typeId.not.fts\\": string;
        and: Omit<TestParams, \\"include\\" | \\"cursor\\" | \\"page\\" | \\"limit\\"> | Omit<TestParams, \\"include\\" | \\"cursor\\" | \\"page\\" | \\"limit\\">[];
        not.and: Omit<TestParams, \\"include\\" | \\"cursor\\" | \\"page\\" | \\"limit\\"> | Omit<TestParams, \\"include\\" | \\"cursor\\" | \\"page\\" | \\"limit\\">[];
        or: Omit<TestParams, \\"include\\" | \\"cursor\\" | \\"page\\" | \\"limit\\"> | Omit<TestParams, \\"include\\" | \\"cursor\\" | \\"page\\" | \\"limit\\">[];
        not.or: Omit<TestParams, \\"include\\" | \\"cursor\\" | \\"page\\" | \\"limit\\"> | Omit<TestParams, \\"include\\" | \\"cursor\\" | \\"page\\" | \\"limit\\">[];
        cursor: string;
        page: number;
        limit: number;
        include: ('getThing' | 'getOtherThing')[];
      }>;
      "
    `);
  });

  it("saves lookup tables", async () => {
    const path = Path.resolve(__dirname, "./test.ignore6.ts");

    const core = new Core(knex, () => ({}));

    core.table({
      schemaName: "saveTest",
      tableName: "test",
    });
    core.table({
      schemaName: "saveTest",
      tableName: "types",
      isLookupTable: true,
    });

    await core.saveTsTypes(path, {
      includeRelations: true,
      includeLinks: false,
      includeParams: true,
    });

    const types = await fs.readFile(path, { encoding: "utf8" });
    expect(types).toMatchInlineSnapshot(`
      "export type Test = {
        id: number;
        isBoolean: boolean;
        numberCount: number;
        text: string;
        typeId: \\"type1\\" | \\"type2\\" | \\"type3\\";
        type: Type;
      };

      export type TestParams = Partial<{
        id: number | number[];
        id.not: number | number[];
        \\"id.eq\\": number | number[];
        \\"id.not.eq\\": number | number[];
        \\"id.neq\\": number | number[];
        \\"id.not.neq\\": number | number[];
        \\"id.lt\\": number | number[];
        \\"id.not.lt\\": number | number[];
        \\"id.lte\\": number | number[];
        \\"id.not.lte\\": number | number[];
        \\"id.gt\\": number | number[];
        \\"id.not.gt\\": number | number[];
        \\"id.gte\\": number | number[];
        \\"id.not.gte\\": number | number[];
        isBoolean: boolean | boolean[];
        isBoolean.not: boolean | boolean[];
        \\"isBoolean.eq\\": boolean | boolean[];
        \\"isBoolean.not.eq\\": boolean | boolean[];
        \\"isBoolean.neq\\": boolean | boolean[];
        \\"isBoolean.not.neq\\": boolean | boolean[];
        \\"isBoolean.lt\\": boolean | boolean[];
        \\"isBoolean.not.lt\\": boolean | boolean[];
        \\"isBoolean.lte\\": boolean | boolean[];
        \\"isBoolean.not.lte\\": boolean | boolean[];
        \\"isBoolean.gt\\": boolean | boolean[];
        \\"isBoolean.not.gt\\": boolean | boolean[];
        \\"isBoolean.gte\\": boolean | boolean[];
        \\"isBoolean.not.gte\\": boolean | boolean[];
        numberCount: number | number[];
        numberCount.not: number | number[];
        \\"numberCount.eq\\": number | number[];
        \\"numberCount.not.eq\\": number | number[];
        \\"numberCount.neq\\": number | number[];
        \\"numberCount.not.neq\\": number | number[];
        \\"numberCount.lt\\": number | number[];
        \\"numberCount.not.lt\\": number | number[];
        \\"numberCount.lte\\": number | number[];
        \\"numberCount.not.lte\\": number | number[];
        \\"numberCount.gt\\": number | number[];
        \\"numberCount.not.gt\\": number | number[];
        \\"numberCount.gte\\": number | number[];
        \\"numberCount.not.gte\\": number | number[];
        text: string | string[];
        text.not: string | string[];
        \\"text.eq\\": string | string[];
        \\"text.not.eq\\": string | string[];
        \\"text.neq\\": string | string[];
        \\"text.not.neq\\": string | string[];
        \\"text.lt\\": string | string[];
        \\"text.not.lt\\": string | string[];
        \\"text.lte\\": string | string[];
        \\"text.not.lte\\": string | string[];
        \\"text.gt\\": string | string[];
        \\"text.not.gt\\": string | string[];
        \\"text.gte\\": string | string[];
        \\"text.not.gte\\": string | string[];
        \\"text.fts\\": string;
        \\"text.not.fts\\": string;
        typeId: (\\"type1\\" | \\"type2\\" | \\"type3\\") | (\\"type1\\" | \\"type2\\" | \\"type3\\")[];
        typeId.not: (\\"type1\\" | \\"type2\\" | \\"type3\\") | (\\"type1\\" | \\"type2\\" | \\"type3\\")[];
        \\"typeId.eq\\": (\\"type1\\" | \\"type2\\" | \\"type3\\") | (\\"type1\\" | \\"type2\\" | \\"type3\\")[];
        \\"typeId.not.eq\\": (\\"type1\\" | \\"type2\\" | \\"type3\\") | (\\"type1\\" | \\"type2\\" | \\"type3\\")[];
        \\"typeId.neq\\": (\\"type1\\" | \\"type2\\" | \\"type3\\") | (\\"type1\\" | \\"type2\\" | \\"type3\\")[];
        \\"typeId.not.neq\\": (\\"type1\\" | \\"type2\\" | \\"type3\\") | (\\"type1\\" | \\"type2\\" | \\"type3\\")[];
        \\"typeId.lt\\": (\\"type1\\" | \\"type2\\" | \\"type3\\") | (\\"type1\\" | \\"type2\\" | \\"type3\\")[];
        \\"typeId.not.lt\\": (\\"type1\\" | \\"type2\\" | \\"type3\\") | (\\"type1\\" | \\"type2\\" | \\"type3\\")[];
        \\"typeId.lte\\": (\\"type1\\" | \\"type2\\" | \\"type3\\") | (\\"type1\\" | \\"type2\\" | \\"type3\\")[];
        \\"typeId.not.lte\\": (\\"type1\\" | \\"type2\\" | \\"type3\\") | (\\"type1\\" | \\"type2\\" | \\"type3\\")[];
        \\"typeId.gt\\": (\\"type1\\" | \\"type2\\" | \\"type3\\") | (\\"type1\\" | \\"type2\\" | \\"type3\\")[];
        \\"typeId.not.gt\\": (\\"type1\\" | \\"type2\\" | \\"type3\\") | (\\"type1\\" | \\"type2\\" | \\"type3\\")[];
        \\"typeId.gte\\": (\\"type1\\" | \\"type2\\" | \\"type3\\") | (\\"type1\\" | \\"type2\\" | \\"type3\\")[];
        \\"typeId.not.gte\\": (\\"type1\\" | \\"type2\\" | \\"type3\\") | (\\"type1\\" | \\"type2\\" | \\"type3\\")[];
        and: Omit<TestParams, \\"include\\" | \\"cursor\\" | \\"page\\" | \\"limit\\"> | Omit<TestParams, \\"include\\" | \\"cursor\\" | \\"page\\" | \\"limit\\">[];
        not.and: Omit<TestParams, \\"include\\" | \\"cursor\\" | \\"page\\" | \\"limit\\"> | Omit<TestParams, \\"include\\" | \\"cursor\\" | \\"page\\" | \\"limit\\">[];
        or: Omit<TestParams, \\"include\\" | \\"cursor\\" | \\"page\\" | \\"limit\\"> | Omit<TestParams, \\"include\\" | \\"cursor\\" | \\"page\\" | \\"limit\\">[];
        not.or: Omit<TestParams, \\"include\\" | \\"cursor\\" | \\"page\\" | \\"limit\\"> | Omit<TestParams, \\"include\\" | \\"cursor\\" | \\"page\\" | \\"limit\\">[];
        cursor: string;
        page: number;
        limit: number;
        include: ('type')[];
      }>;

      export type Type = {
        id: \\"type1\\" | \\"type2\\" | \\"type3\\";
        test: Test[];
      };

      export type TypeParams = Partial<{
        id: \\"type1\\" | \\"type2\\" | \\"type3\\" | \\"type1\\" | \\"type2\\" | \\"type3\\"[];
        id.not: \\"type1\\" | \\"type2\\" | \\"type3\\" | \\"type1\\" | \\"type2\\" | \\"type3\\"[];
        \\"id.eq\\": \\"type1\\" | \\"type2\\" | \\"type3\\" | \\"type1\\" | \\"type2\\" | \\"type3\\"[];
        \\"id.not.eq\\": \\"type1\\" | \\"type2\\" | \\"type3\\" | \\"type1\\" | \\"type2\\" | \\"type3\\"[];
        \\"id.neq\\": \\"type1\\" | \\"type2\\" | \\"type3\\" | \\"type1\\" | \\"type2\\" | \\"type3\\"[];
        \\"id.not.neq\\": \\"type1\\" | \\"type2\\" | \\"type3\\" | \\"type1\\" | \\"type2\\" | \\"type3\\"[];
        \\"id.lt\\": \\"type1\\" | \\"type2\\" | \\"type3\\" | \\"type1\\" | \\"type2\\" | \\"type3\\"[];
        \\"id.not.lt\\": \\"type1\\" | \\"type2\\" | \\"type3\\" | \\"type1\\" | \\"type2\\" | \\"type3\\"[];
        \\"id.lte\\": \\"type1\\" | \\"type2\\" | \\"type3\\" | \\"type1\\" | \\"type2\\" | \\"type3\\"[];
        \\"id.not.lte\\": \\"type1\\" | \\"type2\\" | \\"type3\\" | \\"type1\\" | \\"type2\\" | \\"type3\\"[];
        \\"id.gt\\": \\"type1\\" | \\"type2\\" | \\"type3\\" | \\"type1\\" | \\"type2\\" | \\"type3\\"[];
        \\"id.not.gt\\": \\"type1\\" | \\"type2\\" | \\"type3\\" | \\"type1\\" | \\"type2\\" | \\"type3\\"[];
        \\"id.gte\\": \\"type1\\" | \\"type2\\" | \\"type3\\" | \\"type1\\" | \\"type2\\" | \\"type3\\"[];
        \\"id.not.gte\\": \\"type1\\" | \\"type2\\" | \\"type3\\" | \\"type1\\" | \\"type2\\" | \\"type3\\"[];
        and: Omit<TypeParams, \\"include\\" | \\"cursor\\" | \\"page\\" | \\"limit\\"> | Omit<TypeParams, \\"include\\" | \\"cursor\\" | \\"page\\" | \\"limit\\">[];
        not.and: Omit<TypeParams, \\"include\\" | \\"cursor\\" | \\"page\\" | \\"limit\\"> | Omit<TypeParams, \\"include\\" | \\"cursor\\" | \\"page\\" | \\"limit\\">[];
        or: Omit<TypeParams, \\"include\\" | \\"cursor\\" | \\"page\\" | \\"limit\\"> | Omit<TypeParams, \\"include\\" | \\"cursor\\" | \\"page\\" | \\"limit\\">[];
        not.or: Omit<TypeParams, \\"include\\" | \\"cursor\\" | \\"page\\" | \\"limit\\"> | Omit<TypeParams, \\"include\\" | \\"cursor\\" | \\"page\\" | \\"limit\\">[];
        cursor: string;
        page: number;
        limit: number;
        include: ('test')[];
      }>;
      "
    `);
  });

  it("does not save empty lookup tables", async () => {
    const path = Path.resolve(__dirname, "./test.ignore7.ts");

    const core = new Core(knex, () => ({}));

    await knex("saveTest.types").del();

    core.table({
      schemaName: "saveTest",
      tableName: "test",
    });
    core.table({
      schemaName: "saveTest",
      tableName: "types",
      isLookupTable: true,
    });

    await core.saveTsTypes(path, {
      includeRelations: true,
      includeLinks: false,
      includeParams: true,
    });

    const types = await fs.readFile(path, { encoding: "utf8" });
    expect(types).toMatchInlineSnapshot(`
      "export type Test = {
        id: number;
        isBoolean: boolean;
        numberCount: number;
        text: string;
        typeId: string;
        type: Type;
      };

      export type TestParams = Partial<{
        id: number | number[];
        id.not: number | number[];
        \\"id.eq\\": number | number[];
        \\"id.not.eq\\": number | number[];
        \\"id.neq\\": number | number[];
        \\"id.not.neq\\": number | number[];
        \\"id.lt\\": number | number[];
        \\"id.not.lt\\": number | number[];
        \\"id.lte\\": number | number[];
        \\"id.not.lte\\": number | number[];
        \\"id.gt\\": number | number[];
        \\"id.not.gt\\": number | number[];
        \\"id.gte\\": number | number[];
        \\"id.not.gte\\": number | number[];
        isBoolean: boolean | boolean[];
        isBoolean.not: boolean | boolean[];
        \\"isBoolean.eq\\": boolean | boolean[];
        \\"isBoolean.not.eq\\": boolean | boolean[];
        \\"isBoolean.neq\\": boolean | boolean[];
        \\"isBoolean.not.neq\\": boolean | boolean[];
        \\"isBoolean.lt\\": boolean | boolean[];
        \\"isBoolean.not.lt\\": boolean | boolean[];
        \\"isBoolean.lte\\": boolean | boolean[];
        \\"isBoolean.not.lte\\": boolean | boolean[];
        \\"isBoolean.gt\\": boolean | boolean[];
        \\"isBoolean.not.gt\\": boolean | boolean[];
        \\"isBoolean.gte\\": boolean | boolean[];
        \\"isBoolean.not.gte\\": boolean | boolean[];
        numberCount: number | number[];
        numberCount.not: number | number[];
        \\"numberCount.eq\\": number | number[];
        \\"numberCount.not.eq\\": number | number[];
        \\"numberCount.neq\\": number | number[];
        \\"numberCount.not.neq\\": number | number[];
        \\"numberCount.lt\\": number | number[];
        \\"numberCount.not.lt\\": number | number[];
        \\"numberCount.lte\\": number | number[];
        \\"numberCount.not.lte\\": number | number[];
        \\"numberCount.gt\\": number | number[];
        \\"numberCount.not.gt\\": number | number[];
        \\"numberCount.gte\\": number | number[];
        \\"numberCount.not.gte\\": number | number[];
        text: string | string[];
        text.not: string | string[];
        \\"text.eq\\": string | string[];
        \\"text.not.eq\\": string | string[];
        \\"text.neq\\": string | string[];
        \\"text.not.neq\\": string | string[];
        \\"text.lt\\": string | string[];
        \\"text.not.lt\\": string | string[];
        \\"text.lte\\": string | string[];
        \\"text.not.lte\\": string | string[];
        \\"text.gt\\": string | string[];
        \\"text.not.gt\\": string | string[];
        \\"text.gte\\": string | string[];
        \\"text.not.gte\\": string | string[];
        \\"text.fts\\": string;
        \\"text.not.fts\\": string;
        typeId: string | string[];
        typeId.not: string | string[];
        \\"typeId.eq\\": string | string[];
        \\"typeId.not.eq\\": string | string[];
        \\"typeId.neq\\": string | string[];
        \\"typeId.not.neq\\": string | string[];
        \\"typeId.lt\\": string | string[];
        \\"typeId.not.lt\\": string | string[];
        \\"typeId.lte\\": string | string[];
        \\"typeId.not.lte\\": string | string[];
        \\"typeId.gt\\": string | string[];
        \\"typeId.not.gt\\": string | string[];
        \\"typeId.gte\\": string | string[];
        \\"typeId.not.gte\\": string | string[];
        \\"typeId.fts\\": string;
        \\"typeId.not.fts\\": string;
        and: Omit<TestParams, \\"include\\" | \\"cursor\\" | \\"page\\" | \\"limit\\"> | Omit<TestParams, \\"include\\" | \\"cursor\\" | \\"page\\" | \\"limit\\">[];
        not.and: Omit<TestParams, \\"include\\" | \\"cursor\\" | \\"page\\" | \\"limit\\"> | Omit<TestParams, \\"include\\" | \\"cursor\\" | \\"page\\" | \\"limit\\">[];
        or: Omit<TestParams, \\"include\\" | \\"cursor\\" | \\"page\\" | \\"limit\\"> | Omit<TestParams, \\"include\\" | \\"cursor\\" | \\"page\\" | \\"limit\\">[];
        not.or: Omit<TestParams, \\"include\\" | \\"cursor\\" | \\"page\\" | \\"limit\\"> | Omit<TestParams, \\"include\\" | \\"cursor\\" | \\"page\\" | \\"limit\\">[];
        cursor: string;
        page: number;
        limit: number;
        include: ('type')[];
      }>;

      export type Type = {
        id: string;
        test: Test[];
      };

      export type TypeParams = Partial<{
        id: string | string[];
        id.not: string | string[];
        \\"id.eq\\": string | string[];
        \\"id.not.eq\\": string | string[];
        \\"id.neq\\": string | string[];
        \\"id.not.neq\\": string | string[];
        \\"id.lt\\": string | string[];
        \\"id.not.lt\\": string | string[];
        \\"id.lte\\": string | string[];
        \\"id.not.lte\\": string | string[];
        \\"id.gt\\": string | string[];
        \\"id.not.gt\\": string | string[];
        \\"id.gte\\": string | string[];
        \\"id.not.gte\\": string | string[];
        \\"id.fts\\": string;
        \\"id.not.fts\\": string;
        and: Omit<TypeParams, \\"include\\" | \\"cursor\\" | \\"page\\" | \\"limit\\"> | Omit<TypeParams, \\"include\\" | \\"cursor\\" | \\"page\\" | \\"limit\\">[];
        not.and: Omit<TypeParams, \\"include\\" | \\"cursor\\" | \\"page\\" | \\"limit\\"> | Omit<TypeParams, \\"include\\" | \\"cursor\\" | \\"page\\" | \\"limit\\">[];
        or: Omit<TypeParams, \\"include\\" | \\"cursor\\" | \\"page\\" | \\"limit\\"> | Omit<TypeParams, \\"include\\" | \\"cursor\\" | \\"page\\" | \\"limit\\">[];
        not.or: Omit<TypeParams, \\"include\\" | \\"cursor\\" | \\"page\\" | \\"limit\\"> | Omit<TypeParams, \\"include\\" | \\"cursor\\" | \\"page\\" | \\"limit\\">[];
        cursor: string;
        page: number;
        limit: number;
        include: ('test')[];
      }>;
      "
    `);
  });
});
