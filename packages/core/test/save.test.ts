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
            "lookupTableIds": Array [],
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
            "lookupTableIds": Array [],
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
          "select test__base_table.id, test__base_table.is_boolean, test__base_table.number_count, test__base_table.text, test__base_table.type_id from save_test.test test__base_table order by test__base_table.id asc limit ?",
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
      "type Optional<T, K extends keyof T> = Omit<T, K> & Partial<T>;

      export type TestId = number;
      export type TestRow = {
        id: TestId;
        isBoolean: boolean;
        numberCount: number;
        text: string;
        typeId: string;
      };

      export type TestLinks = {
        _url: string;
        _type: string;
        _links: {
          testSub: string;
          testSubNullable: string;
        };
      };

      export type Test = TestRow & TestLinks;
      export type TestInsert = Optional<TestRow, \\"id\\" | \\"isBoolean\\" | \\"numberCount\\" | \\"text\\"> & {_url: never, _links: never, _type: never};
      export type TestUpdate = Partial<TestRow> & {_url: never, _links: never, _type: never};
      export type TestWrite = TestInsert | (TestUpdate & { id: TestId });

      export type TestConfig = {
        item: Test;
        row: TestRow;
        insert: TestInsert;
        update: TestUpdate;
        id: TestId;
        idColumnName: \\"id\\";
      }

      export type TestNullableId = number;
      export type TestNullableRow = {
        id: TestNullableId;
        isBoolean: boolean;
        numberCount: number;
        text: string;
      };

      export type TestNullableLinks = {
        _url: string;
        _type: string;
        _links: {
        };
      };

      export type TestNullable = TestNullableRow & TestNullableLinks;
      export type TestNullableInsert = Optional<TestNullableRow, \\"id\\" | \\"isBoolean\\" | \\"numberCount\\" | \\"text\\"> & {_url: never, _links: never, _type: never};
      export type TestNullableUpdate = Partial<TestNullableRow> & {_url: never, _links: never, _type: never};
      export type TestNullableWrite = TestNullableInsert | (TestNullableUpdate & { id: TestNullableId });

      export type TestNullableConfig = {
        item: TestNullable;
        row: TestNullableRow;
        insert: TestNullableInsert;
        update: TestNullableUpdate;
        id: TestNullableId;
        idColumnName: \\"id\\";
      }

      export type TestSubId = number;
      export type TestSubRow = {
        id: TestSubId;
        parentId: number;
        arr: number[] | null;
      };

      export type TestSubLinks = {
        _url: string;
        _type: string;
        _links: {
          parent: string;
        };
      };

      export type TestSub = TestSubRow & TestSubLinks;
      export type TestSubInsert = Optional<TestSubRow, \\"id\\" | \\"parentId\\" | \\"arr\\"> & {_url: never, _links: never, _type: never};
      export type TestSubUpdate = Partial<TestSubRow> & {_url: never, _links: never, _type: never};
      export type TestSubWrite = TestSubInsert | (TestSubUpdate & { id: TestSubId });

      export type TestSubConfig = {
        item: TestSub;
        row: TestSubRow;
        insert: TestSubInsert;
        update: TestSubUpdate;
        id: TestSubId;
        idColumnName: \\"id\\";
      }

      export type TestSubNullableId = number;
      export type TestSubNullableRow = {
        id: TestSubNullableId;
        parentId: number | null;
        arr: number[] | null;
      };

      export type TestSubNullableLinks = {
        _url: string;
        _type: string;
        _links: {
          parent?: string;
        };
      };

      export type TestSubNullable = TestSubNullableRow & TestSubNullableLinks;
      export type TestSubNullableInsert = Optional<TestSubNullableRow, \\"id\\" | \\"parentId\\" | \\"arr\\"> & {_url: never, _links: never, _type: never};
      export type TestSubNullableUpdate = Partial<TestSubNullableRow> & {_url: never, _links: never, _type: never};
      export type TestSubNullableWrite = TestSubNullableInsert | (TestSubNullableUpdate & { id: TestSubNullableId });

      export type TestSubNullableConfig = {
        item: TestSubNullable;
        row: TestSubNullableRow;
        insert: TestSubNullableInsert;
        update: TestSubNullableUpdate;
        id: TestSubNullableId;
        idColumnName: \\"id\\";
      }
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
      "type Optional<T, K extends keyof T> = Omit<T, K> & Partial<T>;

      export type TestId = number;
      export type TestRow = {
        id: TestId;
        isBoolean: boolean;
        numberCount: number;
        text: string;
        typeId: string;
      };

      export type Test = TestRow;
      export type TestInsert = Optional<TestRow, \\"id\\" | \\"isBoolean\\" | \\"numberCount\\" | \\"text\\">;
      export type TestUpdate = Partial<TestRow>;
      export type TestWrite = TestInsert | (TestUpdate & { id: TestId });

      export type TestConfig = {
        item: Test;
        row: TestRow;
        insert: TestInsert;
        update: TestUpdate;
        id: TestId;
        idColumnName: \\"id\\";
      }

      export type TestNullableId = number;
      export type TestNullableRow = {
        id: TestNullableId;
        isBoolean: boolean;
        numberCount: number;
        text: string;
      };

      export type TestNullable = TestNullableRow;
      export type TestNullableInsert = Optional<TestNullableRow, \\"id\\" | \\"isBoolean\\" | \\"numberCount\\" | \\"text\\">;
      export type TestNullableUpdate = Partial<TestNullableRow>;
      export type TestNullableWrite = TestNullableInsert | (TestNullableUpdate & { id: TestNullableId });

      export type TestNullableConfig = {
        item: TestNullable;
        row: TestNullableRow;
        insert: TestNullableInsert;
        update: TestNullableUpdate;
        id: TestNullableId;
        idColumnName: \\"id\\";
      }

      export type TestSubId = number;
      export type TestSubRow = {
        id: TestSubId;
        parentId: number;
        arr: number[] | null;
      };

      export type TestSub = TestSubRow;
      export type TestSubInsert = Optional<TestSubRow, \\"id\\" | \\"parentId\\" | \\"arr\\">;
      export type TestSubUpdate = Partial<TestSubRow>;
      export type TestSubWrite = TestSubInsert | (TestSubUpdate & { id: TestSubId });

      export type TestSubConfig = {
        item: TestSub;
        row: TestSubRow;
        insert: TestSubInsert;
        update: TestSubUpdate;
        id: TestSubId;
        idColumnName: \\"id\\";
      }

      export type TestSubNullableId = number;
      export type TestSubNullableRow = {
        id: TestSubNullableId;
        parentId: number | null;
        arr: number[] | null;
      };

      export type TestSubNullable = TestSubNullableRow;
      export type TestSubNullableInsert = Optional<TestSubNullableRow, \\"id\\" | \\"parentId\\" | \\"arr\\">;
      export type TestSubNullableUpdate = Partial<TestSubNullableRow>;
      export type TestSubNullableWrite = TestSubNullableInsert | (TestSubNullableUpdate & { id: TestSubNullableId });

      export type TestSubNullableConfig = {
        item: TestSubNullable;
        row: TestSubNullableRow;
        insert: TestSubNullableInsert;
        update: TestSubNullableUpdate;
        id: TestSubNullableId;
        idColumnName: \\"id\\";
      }
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
      "type Optional<T, K extends keyof T> = Omit<T, K> & Partial<T>;

      export type TestId = number;
      export type TestRow = {
        id: TestId;
        isBoolean: boolean;
        numberCount: number;
        text: string;
        typeId: string;
      };

      export type TestRelations = {
      };

      export type TestWriteRelations = ({ testSub?: TestSubWrite[] })&  
      ({ testSubNullable?: TestSubNullableWrite[] });

      export type TestGetters = {
        testSub: TestSub[];
        testSubCount: number;
        testSubNullable: TestSubNullable[];
        testSubNullableCount: number;
      };

      export type Test = TestRow & TestRelations & TestGetters;
      export type TestInsert = Optional<TestRow, \\"id\\" | \\"isBoolean\\" | \\"numberCount\\" | \\"text\\"> & TestWriteRelations;
      export type TestUpdate = Partial<TestRow> & TestWriteRelations;
      export type TestWrite = TestInsert | (TestUpdate & { id: TestId });

      export type TestConfig = {
        item: Test;
        row: TestRow;
        insert: TestInsert;
        update: TestUpdate;
        id: TestId;
        idColumnName: \\"id\\";
      }

      export type TestNullableId = number;
      export type TestNullableRow = {
        id: TestNullableId;
        isBoolean: boolean;
        numberCount: number;
        text: string;
      };

      export type TestNullableRelations = {
      };

      export type TestNullableWriteRelations = {};

      export type TestNullableGetters = {
      };

      export type TestNullable = TestNullableRow & TestNullableRelations & TestNullableGetters;
      export type TestNullableInsert = Optional<TestNullableRow, \\"id\\" | \\"isBoolean\\" | \\"numberCount\\" | \\"text\\"> & TestNullableWriteRelations;
      export type TestNullableUpdate = Partial<TestNullableRow> & TestNullableWriteRelations;
      export type TestNullableWrite = TestNullableInsert | (TestNullableUpdate & { id: TestNullableId });

      export type TestNullableConfig = {
        item: TestNullable;
        row: TestNullableRow;
        insert: TestNullableInsert;
        update: TestNullableUpdate;
        id: TestNullableId;
        idColumnName: \\"id\\";
      }

      export type TestSubId = number;
      export type TestSubRow = {
        id: TestSubId;
        parentId: number;
        arr: number[] | null;
      };

      export type TestSubRelations = {
        parent: Test;
      };

      export type TestSubWriteRelations = ({ parent: TestWrite } | { parentId: TestId });

      export type TestSubGetters = {
      };

      export type TestSub = TestSubRow & TestSubRelations & TestSubGetters;
      export type TestSubInsert = Optional<TestSubRow, \\"id\\" | \\"parentId\\" | \\"arr\\"> & TestSubWriteRelations;
      export type TestSubUpdate = Partial<TestSubRow> & TestSubWriteRelations;
      export type TestSubWrite = TestSubInsert | (TestSubUpdate & { id: TestSubId });

      export type TestSubConfig = {
        item: TestSub;
        row: TestSubRow;
        insert: TestSubInsert;
        update: TestSubUpdate;
        id: TestSubId;
        idColumnName: \\"id\\";
      }

      export type TestSubNullableId = number;
      export type TestSubNullableRow = {
        id: TestSubNullableId;
        parentId: number | null;
        arr: number[] | null;
      };

      export type TestSubNullableRelations = {
        parent?: Test;
      };

      export type TestSubNullableWriteRelations = ({ parent: TestWrite } | { parentId?: TestId  | null});

      export type TestSubNullableGetters = {
      };

      export type TestSubNullable = TestSubNullableRow & TestSubNullableRelations & TestSubNullableGetters;
      export type TestSubNullableInsert = Optional<TestSubNullableRow, \\"id\\" | \\"parentId\\" | \\"arr\\"> & TestSubNullableWriteRelations;
      export type TestSubNullableUpdate = Partial<TestSubNullableRow> & TestSubNullableWriteRelations;
      export type TestSubNullableWrite = TestSubNullableInsert | (TestSubNullableUpdate & { id: TestSubNullableId });

      export type TestSubNullableConfig = {
        item: TestSubNullable;
        row: TestSubNullableRow;
        insert: TestSubNullableInsert;
        update: TestSubNullableUpdate;
        id: TestSubNullableId;
        idColumnName: \\"id\\";
      }
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
      "type Optional<T, K extends keyof T> = Omit<T, K> & Partial<T>;

      type CollectionParams = {
        cursor: string;
        page: number;
        limit: number;
      };

      type ColumnParam<Name extends string, Type> = Record<
        | Name
        | \`\${Name}.not\`
        | \`\${Name}.eq\`
        | \`\${Name}.not.eq\`
        | \`\${Name}.neq\`
        | \`\${Name}.lt\`
        | \`\${Name}.not.lt\`
        | \`\${Name}.lte\`
        | \`\${Name}.not.lte\`
        | \`\${Name}.gt\`
        | \`\${Name}.not.gt\`
        | \`\${Name}.gte\`
        | \`\${Name}.not.gte\`,
        Type
      > &
        (Type extends string ? Record<\`\${Name}.fts\`, Type> : {}) &
        (Type extends null ? Record<\`\${Name}.null\` | \`\${Name}.not.null\`, any> : {});

      type SortParam<T> = Extract<keyof T, string> | \`-\${Extract<keyof T, string>}\`

      export type TestId = number;
      export type TestRow = {
        id: TestId;
        isBoolean: boolean;
        numberCount: number;
        text: string;
        typeId: string;
      };

      export type TestRelations = {
      };

      export type TestWriteRelations = ({ testSub?: TestSubWrite[] })&  
      ({ testSubNullable?: TestSubNullableWrite[] });

      export type TestGetters = {
        testSub: TestSub[];
        testSubCount: number;
        testSubNullable: TestSubNullable[];
        testSubNullableCount: number;
      };

      export type TestFilters = ColumnParam<\\"id\\", TestId | TestId[]> &
        ColumnParam<\\"isBoolean\\", boolean | boolean[]> &
        ColumnParam<\\"numberCount\\", number | number[]> &
        ColumnParam<\\"text\\", string | string[]> &
        ColumnParam<\\"typeId\\", string | string[]> & {
          and: TestFilters | TestFilters[];
          \\"not.and\\": TestFilters | TestFilters[];
          or: TestFilters | TestFilters[];
          \\"not.or\\": TestFilters | TestFilters[];
        };

      export type TestParams = TestFilters &
        CollectionParams & {
          include: 'testSub' | 'testSubNullable' | 'testSubCount' | 'testSubNullableCount' | ('testSub' | 'testSubNullable' | 'testSubCount' | 'testSubNullableCount')[] | { testSub: true | TestSubParams['include']; testSubNullable: true | TestSubNullableParams['include']; testSubCount: true; testSubNullableCount: true };
          sort: SortParam<Test> | SortParam<Test>[];
        };

      export type Test = TestRow & TestRelations & TestGetters;
      export type TestInsert = Optional<TestRow, \\"id\\" | \\"isBoolean\\" | \\"numberCount\\" | \\"text\\"> & TestWriteRelations;
      export type TestUpdate = Partial<TestRow> & TestWriteRelations;
      export type TestWrite = TestInsert | (TestUpdate & { id: TestId });

      export type TestConfig = {
        item: Test;
        row: TestRow;
        params: TestParams;
        insert: TestInsert;
        update: TestUpdate;
        id: TestId;
        idColumnName: \\"id\\";
      }

      export type TestNullableId = number;
      export type TestNullableRow = {
        id: TestNullableId;
        isBoolean: boolean;
        numberCount: number;
        text: string;
      };

      export type TestNullableRelations = {
      };

      export type TestNullableWriteRelations = {};

      export type TestNullableGetters = {
      };

      export type TestNullableFilters = ColumnParam<\\"id\\", TestNullableId | TestNullableId[]> &
        ColumnParam<\\"isBoolean\\", boolean | boolean[]> &
        ColumnParam<\\"numberCount\\", number | number[]> &
        ColumnParam<\\"text\\", string | string[]> & {
          and: TestNullableFilters | TestNullableFilters[];
          \\"not.and\\": TestNullableFilters | TestNullableFilters[];
          or: TestNullableFilters | TestNullableFilters[];
          \\"not.or\\": TestNullableFilters | TestNullableFilters[];
        };

      export type TestNullableParams = (TestNullableFilters | { id: \\"me\\" }) &
        CollectionParams & {
          sort: SortParam<TestNullable> | SortParam<TestNullable>[];
        };

      export type TestNullable = TestNullableRow & TestNullableRelations & TestNullableGetters;
      export type TestNullableInsert = Optional<TestNullableRow, \\"id\\" | \\"isBoolean\\" | \\"numberCount\\" | \\"text\\"> & TestNullableWriteRelations;
      export type TestNullableUpdate = Partial<TestNullableRow> & TestNullableWriteRelations;
      export type TestNullableWrite = TestNullableInsert | (TestNullableUpdate & { id: TestNullableId });

      export type TestNullableConfig = {
        item: TestNullable;
        row: TestNullableRow;
        params: TestNullableParams;
        insert: TestNullableInsert;
        update: TestNullableUpdate;
        id: TestNullableId;
        idColumnName: \\"id\\";
      }

      export type TestSubId = number;
      export type TestSubRow = {
        id: TestSubId;
        parentId: number;
        arr: number[] | null;
      };

      export type TestSubRelations = {
        parent: Test;
      };

      export type TestSubWriteRelations = ({ parent: TestWrite } | { parentId: TestId });

      export type TestSubGetters = {
      };

      export type TestSubFilters = ColumnParam<\\"id\\", TestSubId | TestSubId[]> &
        ColumnParam<\\"parentId\\", number | number[]> &
        ColumnParam<\\"arr\\", number[] | null> & {
          parent: TestFilters;
          \\"parent.not\\": TestFilters;
          and: TestSubFilters | TestSubFilters[];
          \\"not.and\\": TestSubFilters | TestSubFilters[];
          or: TestSubFilters | TestSubFilters[];
          \\"not.or\\": TestSubFilters | TestSubFilters[];
        };

      export type TestSubParams = TestSubFilters &
        CollectionParams & {
          thing: unknown;
          include: 'parent' | ('parent')[] | { parent: true | TestParams['include'] };
          sort: SortParam<TestSub> | SortParam<TestSub>[];
        };

      export type TestSub = TestSubRow & TestSubRelations & TestSubGetters;
      export type TestSubInsert = Optional<TestSubRow, \\"id\\" | \\"parentId\\" | \\"arr\\"> & TestSubWriteRelations;
      export type TestSubUpdate = Partial<TestSubRow> & TestSubWriteRelations;
      export type TestSubWrite = TestSubInsert | (TestSubUpdate & { id: TestSubId });

      export type TestSubConfig = {
        item: TestSub;
        row: TestSubRow;
        params: TestSubParams;
        insert: TestSubInsert;
        update: TestSubUpdate;
        id: TestSubId;
        idColumnName: \\"id\\";
      }

      export type TestSubNullableId = number;
      export type TestSubNullableRow = {
        id: TestSubNullableId;
        parentId: number | null;
        arr: number[] | null;
      };

      export type TestSubNullableRelations = {
        parent?: Test;
      };

      export type TestSubNullableWriteRelations = ({ parent: TestWrite } | { parentId?: TestId  | null});

      export type TestSubNullableGetters = {
      };

      export type TestSubNullableFilters = ColumnParam<\\"id\\", TestSubNullableId | TestSubNullableId[]> &
        ColumnParam<\\"parentId\\", number | number[] | null> &
        ColumnParam<\\"arr\\", number[] | null> & {
          parent: TestFilters;
          \\"parent.not\\": TestFilters;
          and: TestSubNullableFilters | TestSubNullableFilters[];
          \\"not.and\\": TestSubNullableFilters | TestSubNullableFilters[];
          or: TestSubNullableFilters | TestSubNullableFilters[];
          \\"not.or\\": TestSubNullableFilters | TestSubNullableFilters[];
        };

      export type TestSubNullableParams = TestSubNullableFilters &
        CollectionParams & {
          include: 'parent' | ('parent')[] | { parent: true | TestParams['include'] };
          sort: SortParam<TestSubNullable> | SortParam<TestSubNullable>[];
        };

      export type TestSubNullable = TestSubNullableRow & TestSubNullableRelations & TestSubNullableGetters;
      export type TestSubNullableInsert = Optional<TestSubNullableRow, \\"id\\" | \\"parentId\\" | \\"arr\\"> & TestSubNullableWriteRelations;
      export type TestSubNullableUpdate = Partial<TestSubNullableRow> & TestSubNullableWriteRelations;
      export type TestSubNullableWrite = TestSubNullableInsert | (TestSubNullableUpdate & { id: TestSubNullableId });

      export type TestSubNullableConfig = {
        item: TestSubNullable;
        row: TestSubNullableRow;
        params: TestSubNullableParams;
        insert: TestSubNullableInsert;
        update: TestSubNullableUpdate;
        id: TestSubNullableId;
        idColumnName: \\"id\\";
      }
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
      "type Optional<T, K extends keyof T> = Omit<T, K> & Partial<T>;

      type CollectionParams = {
        cursor: string;
        page: number;
        limit: number;
      };

      type ColumnParam<Name extends string, Type> = Record<
        | Name
        | \`\${Name}.not\`
        | \`\${Name}.eq\`
        | \`\${Name}.not.eq\`
        | \`\${Name}.neq\`
        | \`\${Name}.lt\`
        | \`\${Name}.not.lt\`
        | \`\${Name}.lte\`
        | \`\${Name}.not.lte\`
        | \`\${Name}.gt\`
        | \`\${Name}.not.gt\`
        | \`\${Name}.gte\`
        | \`\${Name}.not.gte\`,
        Type
      > &
        (Type extends string ? Record<\`\${Name}.fts\`, Type> : {}) &
        (Type extends null ? Record<\`\${Name}.null\` | \`\${Name}.not.null\`, any> : {});

      type SortParam<T> = Extract<keyof T, string> | \`-\${Extract<keyof T, string>}\`

      export type TestId = number;
      export type TestRow = {
        id: TestId;
        isBoolean: boolean;
        numberCount: number;
        text: string;
        typeId: string;
      };

      export type TestRelations = {
      };

      export type TestWriteRelations = {};

      export type TestGetters = {
        getOtherThing: any;
        getThing: any;
      };

      export type TestFilters = ColumnParam<\\"id\\", TestId | TestId[]> &
        ColumnParam<\\"isBoolean\\", boolean | boolean[]> &
        ColumnParam<\\"numberCount\\", number | number[]> &
        ColumnParam<\\"text\\", string | string[]> &
        ColumnParam<\\"typeId\\", string | string[]> & {
          and: TestFilters | TestFilters[];
          \\"not.and\\": TestFilters | TestFilters[];
          or: TestFilters | TestFilters[];
          \\"not.or\\": TestFilters | TestFilters[];
        };

      export type TestParams = TestFilters &
        CollectionParams & {
          include: 'getThing' | 'getOtherThing' | ('getThing' | 'getOtherThing')[] | { getThing: true; getOtherThing: true };
          sort: SortParam<Test> | SortParam<Test>[];
        };

      export type Test = TestRow & TestRelations & TestGetters;
      export type TestInsert = Optional<TestRow, \\"id\\" | \\"isBoolean\\" | \\"numberCount\\" | \\"text\\"> & TestWriteRelations;
      export type TestUpdate = Partial<TestRow> & TestWriteRelations;
      export type TestWrite = TestInsert | (TestUpdate & { id: TestId });

      export type TestConfig = {
        item: Test;
        row: TestRow;
        params: TestParams;
        insert: TestInsert;
        update: TestUpdate;
        id: TestId;
        idColumnName: \\"id\\";
      }
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
      "type Optional<T, K extends keyof T> = Omit<T, K> & Partial<T>;

      type CollectionParams = {
        cursor: string;
        page: number;
        limit: number;
      };

      type ColumnParam<Name extends string, Type> = Record<
        | Name
        | \`\${Name}.not\`
        | \`\${Name}.eq\`
        | \`\${Name}.not.eq\`
        | \`\${Name}.neq\`
        | \`\${Name}.lt\`
        | \`\${Name}.not.lt\`
        | \`\${Name}.lte\`
        | \`\${Name}.not.lte\`
        | \`\${Name}.gt\`
        | \`\${Name}.not.gt\`
        | \`\${Name}.gte\`
        | \`\${Name}.not.gte\`,
        Type
      > &
        (Type extends string ? Record<\`\${Name}.fts\`, Type> : {}) &
        (Type extends null ? Record<\`\${Name}.null\` | \`\${Name}.not.null\`, any> : {});

      type SortParam<T> = Extract<keyof T, string> | \`-\${Extract<keyof T, string>}\`

      export type TestId = number;
      export type TestRow = {
        id: TestId;
        isBoolean: boolean;
        numberCount: number;
        text: string;
        typeId: \\"type1\\" | \\"type2\\" | \\"type3\\";
      };

      export type TestRelations = {
        type: Type;
      };

      export type TestWriteRelations = ({ type: TypeWrite } | { typeId: TypeId });

      export type TestGetters = {
      };

      export type TestFilters = ColumnParam<\\"id\\", TestId | TestId[]> &
        ColumnParam<\\"isBoolean\\", boolean | boolean[]> &
        ColumnParam<\\"numberCount\\", number | number[]> &
        ColumnParam<\\"text\\", string | string[]> &
        ColumnParam<\\"typeId\\", string | string[]> & {
          type: TypeFilters;
          \\"type.not\\": TypeFilters;
          and: TestFilters | TestFilters[];
          \\"not.and\\": TestFilters | TestFilters[];
          or: TestFilters | TestFilters[];
          \\"not.or\\": TestFilters | TestFilters[];
        };

      export type TestParams = TestFilters &
        CollectionParams & {
          include: 'type' | ('type')[] | { type: true | TypeParams['include'] };
          sort: SortParam<Test> | SortParam<Test>[];
        };

      export type Test = TestRow & TestRelations & TestGetters;
      export type TestInsert = Optional<TestRow, \\"id\\" | \\"isBoolean\\" | \\"numberCount\\" | \\"text\\" | \\"typeId\\"> & TestWriteRelations;
      export type TestUpdate = Partial<TestRow> & TestWriteRelations;
      export type TestWrite = TestInsert | (TestUpdate & { id: TestId });

      export type TestConfig = {
        item: Test;
        row: TestRow;
        params: TestParams;
        insert: TestInsert;
        update: TestUpdate;
        id: TestId;
        idColumnName: \\"id\\";
      }

      export type TypeId = \\"type1\\" | \\"type2\\" | \\"type3\\";
      export type TypeRow = {
        id: TypeId;
      };

      export type TypeRelations = {
      };

      export type TypeWriteRelations = ({ test?: TestWrite[] });

      export type TypeGetters = {
        test: Test[];
        testCount: number;
      };

      export type TypeFilters = ColumnParam<\\"id\\", TypeId | TypeId[]> & {
          and: TypeFilters | TypeFilters[];
          \\"not.and\\": TypeFilters | TypeFilters[];
          or: TypeFilters | TypeFilters[];
          \\"not.or\\": TypeFilters | TypeFilters[];
        };

      export type TypeParams = TypeFilters &
        CollectionParams & {
          include: 'test' | 'testCount' | ('test' | 'testCount')[] | { test: true | TestParams['include']; testCount: true };
          sort: SortParam<Type> | SortParam<Type>[];
        };

      export type Type = TypeRow & TypeRelations & TypeGetters;
      export type TypeInsert = Type & TypeWriteRelations;
      export type TypeUpdate = Partial<TypeRow> & TypeWriteRelations;
      export type TypeWrite = TypeInsert | (TypeUpdate & { id: TypeId });

      export type TypeConfig = {
        item: Type;
        row: TypeRow;
        params: TypeParams;
        insert: TypeInsert;
        update: TypeUpdate;
        id: TypeId;
        idColumnName: \\"id\\";
      }
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
      "type Optional<T, K extends keyof T> = Omit<T, K> & Partial<T>;

      type CollectionParams = {
        cursor: string;
        page: number;
        limit: number;
      };

      type ColumnParam<Name extends string, Type> = Record<
        | Name
        | \`\${Name}.not\`
        | \`\${Name}.eq\`
        | \`\${Name}.not.eq\`
        | \`\${Name}.neq\`
        | \`\${Name}.lt\`
        | \`\${Name}.not.lt\`
        | \`\${Name}.lte\`
        | \`\${Name}.not.lte\`
        | \`\${Name}.gt\`
        | \`\${Name}.not.gt\`
        | \`\${Name}.gte\`
        | \`\${Name}.not.gte\`,
        Type
      > &
        (Type extends string ? Record<\`\${Name}.fts\`, Type> : {}) &
        (Type extends null ? Record<\`\${Name}.null\` | \`\${Name}.not.null\`, any> : {});

      type SortParam<T> = Extract<keyof T, string> | \`-\${Extract<keyof T, string>}\`

      export type TestId = number;
      export type TestRow = {
        id: TestId;
        isBoolean: boolean;
        numberCount: number;
        text: string;
        typeId: string;
      };

      export type TestRelations = {
        type: Type;
      };

      export type TestWriteRelations = ({ type: TypeWrite } | { typeId: TypeId });

      export type TestGetters = {
      };

      export type TestFilters = ColumnParam<\\"id\\", TestId | TestId[]> &
        ColumnParam<\\"isBoolean\\", boolean | boolean[]> &
        ColumnParam<\\"numberCount\\", number | number[]> &
        ColumnParam<\\"text\\", string | string[]> &
        ColumnParam<\\"typeId\\", string | string[]> & {
          type: TypeFilters;
          \\"type.not\\": TypeFilters;
          and: TestFilters | TestFilters[];
          \\"not.and\\": TestFilters | TestFilters[];
          or: TestFilters | TestFilters[];
          \\"not.or\\": TestFilters | TestFilters[];
        };

      export type TestParams = TestFilters &
        CollectionParams & {
          include: 'type' | ('type')[] | { type: true | TypeParams['include'] };
          sort: SortParam<Test> | SortParam<Test>[];
        };

      export type Test = TestRow & TestRelations & TestGetters;
      export type TestInsert = Optional<TestRow, \\"id\\" | \\"isBoolean\\" | \\"numberCount\\" | \\"text\\" | \\"typeId\\"> & TestWriteRelations;
      export type TestUpdate = Partial<TestRow> & TestWriteRelations;
      export type TestWrite = TestInsert | (TestUpdate & { id: TestId });

      export type TestConfig = {
        item: Test;
        row: TestRow;
        params: TestParams;
        insert: TestInsert;
        update: TestUpdate;
        id: TestId;
        idColumnName: \\"id\\";
      }

      export type TypeId = string;
      export type TypeRow = {
        id: TypeId;
      };

      export type TypeRelations = {
      };

      export type TypeWriteRelations = ({ test?: TestWrite[] });

      export type TypeGetters = {
        test: Test[];
        testCount: number;
      };

      export type TypeFilters = ColumnParam<\\"id\\", TypeId | TypeId[]> & {
          and: TypeFilters | TypeFilters[];
          \\"not.and\\": TypeFilters | TypeFilters[];
          or: TypeFilters | TypeFilters[];
          \\"not.or\\": TypeFilters | TypeFilters[];
        };

      export type TypeParams = TypeFilters &
        CollectionParams & {
          include: 'test' | 'testCount' | ('test' | 'testCount')[] | { test: true | TestParams['include']; testCount: true };
          sort: SortParam<Type> | SortParam<Type>[];
        };

      export type Type = TypeRow & TypeRelations & TypeGetters;
      export type TypeInsert = Type & TypeWriteRelations;
      export type TypeUpdate = Partial<TypeRow> & TypeWriteRelations;
      export type TypeWrite = TypeInsert | (TypeUpdate & { id: TypeId });

      export type TypeConfig = {
        item: Type;
        row: TypeRow;
        params: TypeParams;
        insert: TypeInsert;
        update: TypeUpdate;
        id: TypeId;
        idColumnName: \\"id\\";
      }
      "
    `);
  });

  it("saves knex types", async () => {
    await knex.raw(`drop table if exists save_test_table`);
    await knex.schema.createTable("save_test_table", (t) => {
      t.bigIncrements("id");
      t.timestamp("createdAt").notNullable();
      t.decimal("number_response").notNullable();
    });

    await knex.schema
      .withSchema("saveTest")
      .createTable("lookup_table", (t) => {
        t.text("id").primary();
      });

    const path = Path.resolve(__dirname, "./test.ignore8.ts");

    const core = new Core(knex, () => ({}));

    core.table({
      tableName: "saveTestTable",
    });

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

    core.table({
      schemaName: "saveTest",
      tableName: "lookupTable",
    });

    await core.saveTsTypes(path, {
      includeLinks: false,
      includeKnex: true,
      useJsonTypes: false,
    });

    const types = await fs.readFile(path, { encoding: "utf8" });
    expect(types).toMatchInlineSnapshot(`
      "import { Knex } from \\"knex\\";

      declare module 'knex/types/tables' {
        interface Tables {
          \\"saveTestTable\\": Knex.CompositeTableType<
            SaveTestTable,
            SaveTestTableInsert,
            SaveTestTableUpdate
          >;
          \\"public.saveTestTable\\": Knex.CompositeTableType<
            SaveTestTable,
            SaveTestTableInsert,
            SaveTestTableUpdate
          >;
          \\"saveTest.lookupTable\\": Knex.CompositeTableType<
            LookupTable,
            LookupTableInsert,
            LookupTableUpdate
          >;
          \\"saveTest.test\\": Knex.CompositeTableType<
            Test,
            TestInsert,
            TestUpdate
          >;
          \\"saveTest.testNullable\\": Knex.CompositeTableType<
            TestNullable,
            TestNullableInsert,
            TestNullableUpdate
          >;
          \\"saveTest.testSub\\": Knex.CompositeTableType<
            TestSub,
            TestSubInsert,
            TestSubUpdate
          >;
          \\"saveTest.testSubNullable\\": Knex.CompositeTableType<
            TestSubNullable,
            TestSubNullableInsert,
            TestSubNullableUpdate
          >;
        }
      }

      type Optional<T, K extends keyof T> = Omit<T, K> & Partial<T>;

      export type SaveTestTableId = number;
      export type SaveTestTableRow = {
        id: SaveTestTableId;
        createdAt: Date;
        numberResponse: number;
      };

      export type SaveTestTable = SaveTestTableRow;
      export type SaveTestTableInsert = Optional<SaveTestTableRow, \\"id\\">;
      export type SaveTestTableUpdate = Partial<SaveTestTableRow>;
      export type SaveTestTableWrite = SaveTestTableInsert | (SaveTestTableUpdate & { id: SaveTestTableId });

      export type SaveTestTableConfig = {
        item: SaveTestTable;
        row: SaveTestTableRow;
        insert: SaveTestTableInsert;
        update: SaveTestTableUpdate;
        id: SaveTestTableId;
        idColumnName: \\"id\\";
      }

      export type LookupTableId = string;
      export type LookupTableRow = {
        id: LookupTableId;
      };

      export type LookupTable = LookupTableRow;
      export type LookupTableInsert = LookupTable;
      export type LookupTableUpdate = Partial<LookupTableRow>;
      export type LookupTableWrite = LookupTableInsert | (LookupTableUpdate & { id: LookupTableId });

      export type LookupTableConfig = {
        item: LookupTable;
        row: LookupTableRow;
        insert: LookupTableInsert;
        update: LookupTableUpdate;
        id: LookupTableId;
        idColumnName: \\"id\\";
      }

      export type TestId = number;
      export type TestRow = {
        id: TestId;
        isBoolean: boolean;
        numberCount: number;
        text: string;
        typeId: string;
      };

      export type Test = TestRow;
      export type TestInsert = Optional<TestRow, \\"id\\" | \\"isBoolean\\" | \\"numberCount\\" | \\"text\\">;
      export type TestUpdate = Partial<TestRow>;
      export type TestWrite = TestInsert | (TestUpdate & { id: TestId });

      export type TestConfig = {
        item: Test;
        row: TestRow;
        insert: TestInsert;
        update: TestUpdate;
        id: TestId;
        idColumnName: \\"id\\";
      }

      export type TestNullableId = number;
      export type TestNullableRow = {
        id: TestNullableId;
        isBoolean: boolean;
        numberCount: number;
        text: string;
      };

      export type TestNullable = TestNullableRow;
      export type TestNullableInsert = Optional<TestNullableRow, \\"id\\" | \\"isBoolean\\" | \\"numberCount\\" | \\"text\\">;
      export type TestNullableUpdate = Partial<TestNullableRow>;
      export type TestNullableWrite = TestNullableInsert | (TestNullableUpdate & { id: TestNullableId });

      export type TestNullableConfig = {
        item: TestNullable;
        row: TestNullableRow;
        insert: TestNullableInsert;
        update: TestNullableUpdate;
        id: TestNullableId;
        idColumnName: \\"id\\";
      }

      export type TestSubId = number;
      export type TestSubRow = {
        id: TestSubId;
        parentId: number;
        arr: number[] | null;
      };

      export type TestSub = TestSubRow;
      export type TestSubInsert = Optional<TestSubRow, \\"id\\" | \\"parentId\\" | \\"arr\\">;
      export type TestSubUpdate = Partial<TestSubRow>;
      export type TestSubWrite = TestSubInsert | (TestSubUpdate & { id: TestSubId });

      export type TestSubConfig = {
        item: TestSub;
        row: TestSubRow;
        insert: TestSubInsert;
        update: TestSubUpdate;
        id: TestSubId;
        idColumnName: \\"id\\";
      }

      export type TestSubNullableId = number;
      export type TestSubNullableRow = {
        id: TestSubNullableId;
        parentId: number | null;
        arr: number[] | null;
      };

      export type TestSubNullable = TestSubNullableRow;
      export type TestSubNullableInsert = Optional<TestSubNullableRow, \\"id\\" | \\"parentId\\" | \\"arr\\">;
      export type TestSubNullableUpdate = Partial<TestSubNullableRow>;
      export type TestSubNullableWrite = TestSubNullableInsert | (TestSubNullableUpdate & { id: TestSubNullableId });

      export type TestSubNullableConfig = {
        item: TestSubNullable;
        row: TestSubNullableRow;
        insert: TestSubNullableInsert;
        update: TestSubNullableUpdate;
        id: TestSubNullableId;
        idColumnName: \\"id\\";
      }
      "
    `);
  });

  it("saves recursive tables", async () => {
    await knex.schema.withSchema("saveTest").createTable("recursive", (t) => {
      t.bigIncrements("id").primary();
    });
    await knex.schema.withSchema("saveTest").alterTable("recursive", (t) => {
      t.bigInteger("parentId").references("id").inTable("saveTest.recursive");
    });

    const path = Path.resolve(__dirname, "./test.ignore9.ts");

    const core = new Core(knex, () => ({}));

    core.table({
      schemaName: "saveTest",
      tableName: "recursive",
    });

    await core.saveTsTypes(path, {
      includeRelations: true,
      includeLinks: false,
      includeParams: true,
    });

    const types = await fs.readFile(path, { encoding: "utf8" });
    expect(types).toMatchInlineSnapshot(`
      "type Optional<T, K extends keyof T> = Omit<T, K> & Partial<T>;

      type CollectionParams = {
        cursor: string;
        page: number;
        limit: number;
      };

      type ColumnParam<Name extends string, Type> = Record<
        | Name
        | \`\${Name}.not\`
        | \`\${Name}.eq\`
        | \`\${Name}.not.eq\`
        | \`\${Name}.neq\`
        | \`\${Name}.lt\`
        | \`\${Name}.not.lt\`
        | \`\${Name}.lte\`
        | \`\${Name}.not.lte\`
        | \`\${Name}.gt\`
        | \`\${Name}.not.gt\`
        | \`\${Name}.gte\`
        | \`\${Name}.not.gte\`,
        Type
      > &
        (Type extends string ? Record<\`\${Name}.fts\`, Type> : {}) &
        (Type extends null ? Record<\`\${Name}.null\` | \`\${Name}.not.null\`, any> : {});

      type SortParam<T> = Extract<keyof T, string> | \`-\${Extract<keyof T, string>}\`

      export type RecursiveId = number;
      export type RecursiveRow = {
        id: RecursiveId;
        parentId: number | null;
      };

      export type RecursiveRelations = {
        parent?: Recursive;
      };

      export type RecursiveWriteRelations = ({ parent: RecursiveWrite } | { parentId?: RecursiveId  | null})&  
      ({ recursive?: RecursiveWrite[] });

      export type RecursiveGetters = {
        recursive: Recursive[];
        recursiveCount: number;
      };

      export type RecursiveFilters = ColumnParam<\\"id\\", RecursiveId | RecursiveId[]> &
        ColumnParam<\\"parentId\\", RecursiveId | RecursiveId[] | null> & {
          parent: RecursiveFilters;
          \\"parent.not\\": RecursiveFilters;
          and: RecursiveFilters | RecursiveFilters[];
          \\"not.and\\": RecursiveFilters | RecursiveFilters[];
          or: RecursiveFilters | RecursiveFilters[];
          \\"not.or\\": RecursiveFilters | RecursiveFilters[];
        };

      export type RecursiveParams = RecursiveFilters &
        CollectionParams & {
          include: 'recursive' | 'recursiveCount' | 'parent' | ('recursive' | 'recursiveCount' | 'parent')[] | { recursive: true | RecursiveParams['include']; recursiveCount: true; parent: true | RecursiveParams['include'] };
          sort: SortParam<Recursive> | SortParam<Recursive>[];
        };

      export type Recursive = RecursiveRow & RecursiveRelations & RecursiveGetters;
      export type RecursiveInsert = Optional<RecursiveRow, \\"id\\" | \\"parentId\\"> & RecursiveWriteRelations;
      export type RecursiveUpdate = Partial<RecursiveRow> & RecursiveWriteRelations;
      export type RecursiveWrite = RecursiveInsert | (RecursiveUpdate & { id: RecursiveId });

      export type RecursiveConfig = {
        item: Recursive;
        row: RecursiveRow;
        params: RecursiveParams;
        insert: RecursiveInsert;
        update: RecursiveUpdate;
        id: RecursiveId;
        idColumnName: \\"id\\";
      }
      "
    `);
  });
});
