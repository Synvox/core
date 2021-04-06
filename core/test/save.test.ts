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
    await knex.schema.withSchema("saveTest").createTable("test", (t) => {
      t.bigIncrements("id").primary();
      t.boolean("is_boolean").notNullable().defaultTo(false);
      t.integer("number_count").notNullable().defaultTo(0);
      t.specificType("text", "character varying(10)")
        .notNullable()
        .defaultTo("text");
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
            },
            "relations": Object {},
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
          "select test.id, test.is_boolean, test.number_count, test.text from save_test.test order by test.id asc limit ?",
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
        testSub: TestSub[];
        testSubNullable: TestSubNullable[];
      };

      export type TestParams = Partial<{
        id: number | number[];
        \\"id.eq\\": number | number[];
        \\"id.neq\\": number | number[];
        \\"id.lt\\": number | number[];
        \\"id.lte\\": number | number[];
        \\"id.gt\\": number | number[];
        \\"id.gte\\": number | number[];
        isBoolean: boolean | boolean[];
        \\"isBoolean.eq\\": boolean | boolean[];
        \\"isBoolean.neq\\": boolean | boolean[];
        \\"isBoolean.lt\\": boolean | boolean[];
        \\"isBoolean.lte\\": boolean | boolean[];
        \\"isBoolean.gt\\": boolean | boolean[];
        \\"isBoolean.gte\\": boolean | boolean[];
        numberCount: number | number[];
        \\"numberCount.eq\\": number | number[];
        \\"numberCount.neq\\": number | number[];
        \\"numberCount.lt\\": number | number[];
        \\"numberCount.lte\\": number | number[];
        \\"numberCount.gt\\": number | number[];
        \\"numberCount.gte\\": number | number[];
        text: string | string[];
        \\"text.eq\\": string | string[];
        \\"text.neq\\": string | string[];
        \\"text.lt\\": string | string[];
        \\"text.lte\\": string | string[];
        \\"text.gt\\": string | string[];
        \\"text.gte\\": string | string[];
        \\"text.like\\": string | string[];
        \\"text.ilike\\": string | string[];
        and: Omit<TestParams, \\"include\\" | \\"cursor\\" | \\"page\\" | \\"limit\\">;
        or: Omit<TestParams, \\"include\\" | \\"cursor\\" | \\"page\\" | \\"limit\\">;
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
        id: number | number[];
        \\"id.eq\\": number | number[];
        \\"id.neq\\": number | number[];
        \\"id.lt\\": number | number[];
        \\"id.lte\\": number | number[];
        \\"id.gt\\": number | number[];
        \\"id.gte\\": number | number[];
        isBoolean: boolean | boolean[];
        \\"isBoolean.eq\\": boolean | boolean[];
        \\"isBoolean.neq\\": boolean | boolean[];
        \\"isBoolean.lt\\": boolean | boolean[];
        \\"isBoolean.lte\\": boolean | boolean[];
        \\"isBoolean.gt\\": boolean | boolean[];
        \\"isBoolean.gte\\": boolean | boolean[];
        numberCount: number | number[];
        \\"numberCount.eq\\": number | number[];
        \\"numberCount.neq\\": number | number[];
        \\"numberCount.lt\\": number | number[];
        \\"numberCount.lte\\": number | number[];
        \\"numberCount.gt\\": number | number[];
        \\"numberCount.gte\\": number | number[];
        text: string | string[];
        \\"text.eq\\": string | string[];
        \\"text.neq\\": string | string[];
        \\"text.lt\\": string | string[];
        \\"text.lte\\": string | string[];
        \\"text.gt\\": string | string[];
        \\"text.gte\\": string | string[];
        \\"text.like\\": string | string[];
        \\"text.ilike\\": string | string[];
        and: Omit<TestNullableParams, \\"include\\" | \\"cursor\\" | \\"page\\" | \\"limit\\">;
        or: Omit<TestNullableParams, \\"include\\" | \\"cursor\\" | \\"page\\" | \\"limit\\">;
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
        \\"id.eq\\": number | number[];
        \\"id.neq\\": number | number[];
        \\"id.lt\\": number | number[];
        \\"id.lte\\": number | number[];
        \\"id.gt\\": number | number[];
        \\"id.gte\\": number | number[];
        parentId: number | number[];
        \\"parentId.eq\\": number | number[];
        \\"parentId.neq\\": number | number[];
        \\"parentId.lt\\": number | number[];
        \\"parentId.lte\\": number | number[];
        \\"parentId.gt\\": number | number[];
        \\"parentId.gte\\": number | number[];
        arr: number[] | null;
        \\"arr.eq\\": number[] | null;
        \\"arr.neq\\": number[] | null;
        \\"arr.lt\\": number[] | null;
        \\"arr.lte\\": number[] | null;
        \\"arr.gt\\": number[] | null;
        \\"arr.gte\\": number[] | null;
        thing: any;
        and: Omit<TestSubParams, \\"include\\" | \\"cursor\\" | \\"page\\" | \\"limit\\" | \\"thing\\">;
        or: Omit<TestSubParams, \\"include\\" | \\"cursor\\" | \\"page\\" | \\"limit\\" | \\"thing\\">;
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
        \\"id.eq\\": number | number[];
        \\"id.neq\\": number | number[];
        \\"id.lt\\": number | number[];
        \\"id.lte\\": number | number[];
        \\"id.gt\\": number | number[];
        \\"id.gte\\": number | number[];
        parentId: number | null | number | null[];
        \\"parentId.eq\\": number | null | number | null[];
        \\"parentId.neq\\": number | null | number | null[];
        \\"parentId.lt\\": number | null | number | null[];
        \\"parentId.lte\\": number | null | number | null[];
        \\"parentId.gt\\": number | null | number | null[];
        \\"parentId.gte\\": number | null | number | null[];
        arr: number[] | null;
        \\"arr.eq\\": number[] | null;
        \\"arr.neq\\": number[] | null;
        \\"arr.lt\\": number[] | null;
        \\"arr.lte\\": number[] | null;
        \\"arr.gt\\": number[] | null;
        \\"arr.gte\\": number[] | null;
        and: Omit<TestSubNullableParams, \\"include\\" | \\"cursor\\" | \\"page\\" | \\"limit\\">;
        or: Omit<TestSubNullableParams, \\"include\\" | \\"cursor\\" | \\"page\\" | \\"limit\\">;
        cursor: string;
        page: number;
        limit: number;
        include: ('parent')[];
      }>;
      "
    `);
  });
});
