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
      "type DeepPartial<T> = { [P in keyof T]?: DeepPartial<T[P]> };

      export type TestId = number;
      export type TestRow = {
        id: TestId;
        isBoolean: boolean;
        numberCount: number;
        text: string;
        typeId: string;
      };

      export type Test = TestRow;
      export type TestConfig = {
        item: Test;
        row: TestRow;
        insert: DeepPartial<Test>;
        update: DeepPartial<Test>;
        params: any;
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
      export type TestNullableConfig = {
        item: TestNullable;
        row: TestNullableRow;
        insert: DeepPartial<TestNullable>;
        update: DeepPartial<TestNullable>;
        params: any;
        id: TestNullableId;
        idColumnName: \\"id\\";
      }

      export type TestSubId = number;
      export type TestSubRow = {
        arr: number[] | null;
        id: TestSubId;
        parentId: number;
      };

      export type TestSub = TestSubRow;
      export type TestSubConfig = {
        item: TestSub;
        row: TestSubRow;
        insert: DeepPartial<TestSub>;
        update: DeepPartial<TestSub>;
        params: any;
        id: TestSubId;
        idColumnName: \\"id\\";
      }

      export type TestSubNullableId = number;
      export type TestSubNullableRow = {
        arr: number[] | null;
        id: TestSubNullableId;
        parentId: number | null;
      };

      export type TestSubNullable = TestSubNullableRow;
      export type TestSubNullableConfig = {
        item: TestSubNullable;
        row: TestSubNullableRow;
        insert: DeepPartial<TestSubNullable>;
        update: DeepPartial<TestSubNullable>;
        params: any;
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
    });

    const types = await fs.readFile(path, { encoding: "utf8" });
    expect(types).toMatchInlineSnapshot(`
      "type DeepPartial<T> = { [P in keyof T]?: DeepPartial<T[P]> };

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

      export type TestGetters = {
        testSub: TestSub[];
        testSubCount: number;
        testSubNullable: TestSubNullable[];
        testSubNullableCount: number;
      };

      export type Test = TestRow & TestRelations & TestGetters;
      export type TestConfig = {
        item: Test;
        row: TestRow;
        insert: DeepPartial<Test>;
        update: DeepPartial<Test>;
        params: any;
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

      export type TestNullableGetters = {
      };

      export type TestNullable = TestNullableRow & TestNullableRelations & TestNullableGetters;
      export type TestNullableConfig = {
        item: TestNullable;
        row: TestNullableRow;
        insert: DeepPartial<TestNullable>;
        update: DeepPartial<TestNullable>;
        params: any;
        id: TestNullableId;
        idColumnName: \\"id\\";
      }

      export type TestSubId = number;
      export type TestSubRow = {
        arr: number[] | null;
        id: TestSubId;
        parentId: number;
      };

      export type TestSubRelations = {
        parent: Test;
      };

      export type TestSubGetters = {
      };

      export type TestSub = TestSubRow & TestSubRelations & TestSubGetters;
      export type TestSubConfig = {
        item: TestSub;
        row: TestSubRow;
        insert: DeepPartial<TestSub>;
        update: DeepPartial<TestSub>;
        params: any;
        id: TestSubId;
        idColumnName: \\"id\\";
      }

      export type TestSubNullableId = number;
      export type TestSubNullableRow = {
        arr: number[] | null;
        id: TestSubNullableId;
        parentId: number | null;
      };

      export type TestSubNullableRelations = {
        parent?: Test;
      };

      export type TestSubNullableGetters = {
      };

      export type TestSubNullable = TestSubNullableRow & TestSubNullableRelations & TestSubNullableGetters;
      export type TestSubNullableConfig = {
        item: TestSubNullable;
        row: TestSubNullableRow;
        insert: DeepPartial<TestSubNullable>;
        update: DeepPartial<TestSubNullable>;
        params: any;
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
    });

    const types = await fs.readFile(path, { encoding: "utf8" });
    expect(types).toMatchInlineSnapshot(`
      "type DeepPartial<T> = { [P in keyof T]?: DeepPartial<T[P]> };

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

      export type TestGetters = {
        testSub: TestSub[];
        testSubCount: number;
        testSubNullable: TestSubNullable[];
        testSubNullableCount: number;
      };

      export type Test = TestRow & TestRelations & TestGetters;
      export type TestConfig = {
        item: Test;
        row: TestRow;
        insert: DeepPartial<Test>;
        update: DeepPartial<Test>;
        params: any;
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

      export type TestNullableGetters = {
      };

      export type TestNullable = TestNullableRow & TestNullableRelations & TestNullableGetters;
      export type TestNullableConfig = {
        item: TestNullable;
        row: TestNullableRow;
        insert: DeepPartial<TestNullable>;
        update: DeepPartial<TestNullable>;
        params: any;
        id: TestNullableId;
        idColumnName: \\"id\\";
      }

      export type TestSubId = number;
      export type TestSubRow = {
        arr: number[] | null;
        id: TestSubId;
        parentId: number;
      };

      export type TestSubRelations = {
        parent: Test;
      };

      export type TestSubGetters = {
      };

      export type TestSub = TestSubRow & TestSubRelations & TestSubGetters;
      export type TestSubConfig = {
        item: TestSub;
        row: TestSubRow;
        insert: DeepPartial<TestSub>;
        update: DeepPartial<TestSub>;
        params: any;
        id: TestSubId;
        idColumnName: \\"id\\";
      }

      export type TestSubNullableId = number;
      export type TestSubNullableRow = {
        arr: number[] | null;
        id: TestSubNullableId;
        parentId: number | null;
      };

      export type TestSubNullableRelations = {
        parent?: Test;
      };

      export type TestSubNullableGetters = {
      };

      export type TestSubNullable = TestSubNullableRow & TestSubNullableRelations & TestSubNullableGetters;
      export type TestSubNullableConfig = {
        item: TestSubNullable;
        row: TestSubNullableRow;
        insert: DeepPartial<TestSubNullable>;
        update: DeepPartial<TestSubNullable>;
        params: any;
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
    });

    const types = await fs.readFile(path, { encoding: "utf8" });
    expect(types).toMatchInlineSnapshot(`
      "type DeepPartial<T> = { [P in keyof T]?: DeepPartial<T[P]> };

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

      export type TestGetters = {
        getOtherThing: any;
        getThing: any;
      };

      export type Test = TestRow & TestRelations & TestGetters;
      export type TestConfig = {
        item: Test;
        row: TestRow;
        insert: DeepPartial<Test>;
        update: DeepPartial<Test>;
        params: any;
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
    });

    const types = await fs.readFile(path, { encoding: "utf8" });
    expect(types).toMatchInlineSnapshot(`
      "type DeepPartial<T> = { [P in keyof T]?: DeepPartial<T[P]> };

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

      export type TestGetters = {
      };

      export type Test = TestRow & TestRelations & TestGetters;
      export type TestConfig = {
        item: Test;
        row: TestRow;
        insert: DeepPartial<Test>;
        update: DeepPartial<Test>;
        params: any;
        id: TestId;
        idColumnName: \\"id\\";
      }

      export type TypeId = \\"type1\\" | \\"type2\\" | \\"type3\\";
      export type TypeRow = {
        id: TypeId;
      };

      export type TypeRelations = {
      };

      export type TypeGetters = {
        test: Test[];
        testCount: number;
      };

      export type Type = TypeRow & TypeRelations & TypeGetters;
      export type TypeConfig = {
        item: Type;
        row: TypeRow;
        insert: DeepPartial<Type>;
        update: DeepPartial<Type>;
        params: any;
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
    });

    const types = await fs.readFile(path, { encoding: "utf8" });
    expect(types).toMatchInlineSnapshot(`
      "type DeepPartial<T> = { [P in keyof T]?: DeepPartial<T[P]> };

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

      export type TestGetters = {
      };

      export type Test = TestRow & TestRelations & TestGetters;
      export type TestConfig = {
        item: Test;
        row: TestRow;
        insert: DeepPartial<Test>;
        update: DeepPartial<Test>;
        params: any;
        id: TestId;
        idColumnName: \\"id\\";
      }

      export type TypeId = string;
      export type TypeRow = {
        id: TypeId;
      };

      export type TypeRelations = {
      };

      export type TypeGetters = {
        test: Test[];
        testCount: number;
      };

      export type Type = TypeRow & TypeRelations & TypeGetters;
      export type TypeConfig = {
        item: Type;
        row: TypeRow;
        insert: DeepPartial<Type>;
        update: DeepPartial<Type>;
        params: any;
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
      includeKnex: true,
      useJsonTypes: false,
    });

    const types = await fs.readFile(path, { encoding: "utf8" });
    expect(types).toMatchInlineSnapshot(`
      "import { Knex } from \\"knex\\";

      type MaybeRaw<T> = {[K in keyof T]: T[K] | Knex.Raw};declare module 'knex/types/tables' {
        interface Tables {
          \\"saveTestTable\\": Knex.CompositeTableType<
            SaveTestTableRow,
            MaybeRaw<Partial<SaveTestTableRow>>,
            MaybeRaw<Partial<SaveTestTableRow>>
          >;
          \\"public.saveTestTable\\": Knex.CompositeTableType<
            SaveTestTableRow,
            MaybeRaw<Partial<SaveTestTableRow>>,
            MaybeRaw<Partial<SaveTestTableRow>>
          >;
          \\"saveTest.lookupTable\\": Knex.CompositeTableType<
            LookupTableRow,
            MaybeRaw<Partial<LookupTableRow>>,
            MaybeRaw<Partial<LookupTableRow>>
          >;
          \\"saveTest.test\\": Knex.CompositeTableType<
            TestRow,
            MaybeRaw<Partial<TestRow>>,
            MaybeRaw<Partial<TestRow>>
          >;
          \\"saveTest.testNullable\\": Knex.CompositeTableType<
            TestNullableRow,
            MaybeRaw<Partial<TestNullableRow>>,
            MaybeRaw<Partial<TestNullableRow>>
          >;
          \\"saveTest.testSub\\": Knex.CompositeTableType<
            TestSubRow,
            MaybeRaw<Partial<TestSubRow>>,
            MaybeRaw<Partial<TestSubRow>>
          >;
          \\"saveTest.testSubNullable\\": Knex.CompositeTableType<
            TestSubNullableRow,
            MaybeRaw<Partial<TestSubNullableRow>>,
            MaybeRaw<Partial<TestSubNullableRow>>
          >;
        }
      }

      type DeepPartial<T> = { [P in keyof T]?: DeepPartial<T[P]> };

      export type SaveTestTableId = number;
      export type SaveTestTableRow = {
        createdAt: Date;
        id: SaveTestTableId;
        numberResponse: number;
      };

      export type SaveTestTable = SaveTestTableRow;
      export type SaveTestTableConfig = {
        item: SaveTestTable;
        row: SaveTestTableRow;
        insert: DeepPartial<SaveTestTable>;
        update: DeepPartial<SaveTestTable>;
        params: any;
        id: SaveTestTableId;
        idColumnName: \\"id\\";
      }

      export type LookupTableId = string;
      export type LookupTableRow = {
        id: LookupTableId;
      };

      export type LookupTable = LookupTableRow;
      export type LookupTableConfig = {
        item: LookupTable;
        row: LookupTableRow;
        insert: DeepPartial<LookupTable>;
        update: DeepPartial<LookupTable>;
        params: any;
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
      export type TestConfig = {
        item: Test;
        row: TestRow;
        insert: DeepPartial<Test>;
        update: DeepPartial<Test>;
        params: any;
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
      export type TestNullableConfig = {
        item: TestNullable;
        row: TestNullableRow;
        insert: DeepPartial<TestNullable>;
        update: DeepPartial<TestNullable>;
        params: any;
        id: TestNullableId;
        idColumnName: \\"id\\";
      }

      export type TestSubId = number;
      export type TestSubRow = {
        arr: number[] | null;
        id: TestSubId;
        parentId: number;
      };

      export type TestSub = TestSubRow;
      export type TestSubConfig = {
        item: TestSub;
        row: TestSubRow;
        insert: DeepPartial<TestSub>;
        update: DeepPartial<TestSub>;
        params: any;
        id: TestSubId;
        idColumnName: \\"id\\";
      }

      export type TestSubNullableId = number;
      export type TestSubNullableRow = {
        arr: number[] | null;
        id: TestSubNullableId;
        parentId: number | null;
      };

      export type TestSubNullable = TestSubNullableRow;
      export type TestSubNullableConfig = {
        item: TestSubNullable;
        row: TestSubNullableRow;
        insert: DeepPartial<TestSubNullable>;
        update: DeepPartial<TestSubNullable>;
        params: any;
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
    });

    const types = await fs.readFile(path, { encoding: "utf8" });
    expect(types).toMatchInlineSnapshot(`
      "type DeepPartial<T> = { [P in keyof T]?: DeepPartial<T[P]> };

      export type RecursiveId = number;
      export type RecursiveRow = {
        id: RecursiveId;
        parentId: number | null;
      };

      export type RecursiveRelations = {
        parent?: Recursive;
      };

      export type RecursiveGetters = {
        recursive: Recursive[];
        recursiveCount: number;
      };

      export type Recursive = RecursiveRow & RecursiveRelations & RecursiveGetters;
      export type RecursiveConfig = {
        item: Recursive;
        row: RecursiveRow;
        insert: DeepPartial<Recursive>;
        update: DeepPartial<Recursive>;
        params: any;
        id: RecursiveId;
        idColumnName: \\"id\\";
      }
      "
    `);
  });
});
