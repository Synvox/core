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
      "type CollectionParams = {
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

      export type Test = {
        id: number;
        isBoolean: boolean;
        numberCount: number;
        text: string;
        typeId: string;
        testSub: TestSub[];
        testSubNullable: TestSubNullable[];
      };

      export type TestFilters = ColumnParam<\\"id\\", number | number[]> &
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
          include: ('testSub' | 'testSubNullable')[];
          sort: 'id' | '-id' | 'isBoolean' | '-isBoolean' | 'numberCount' | '-numberCount' | 'text' | '-text' | 'typeId' | '-typeId' | ('id' | '-id' | 'isBoolean' | '-isBoolean' | 'numberCount' | '-numberCount' | 'text' | '-text' | 'typeId' | '-typeId')[];
        };

      export type TestNullable = {
        id: number;
        isBoolean: boolean;
        numberCount: number;
        text: string;
      };

      export type TestNullableFilters = ColumnParam<\\"id\\", number | number[]> &
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
          sort: 'id' | '-id' | 'isBoolean' | '-isBoolean' | 'numberCount' | '-numberCount' | 'text' | '-text' | ('id' | '-id' | 'isBoolean' | '-isBoolean' | 'numberCount' | '-numberCount' | 'text' | '-text')[];
        };

      export type TestSub = {
        id: number;
        parentId: number;
        arr: number[] | null;
        parent: Test;
      };

      export type TestSubFilters = ColumnParam<\\"id\\", number | number[]> &
        ColumnParam<\\"parentId\\", TestFilters['id']> &
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
          include: 'parent'[];
          sort: 'id' | '-id' | 'parentId' | '-parentId' | 'arr' | '-arr' | ('id' | '-id' | 'parentId' | '-parentId' | 'arr' | '-arr')[];
        };

      export type TestSubNullable = {
        id: number;
        parentId: number | null;
        arr: number[] | null;
        parent?: Test;
      };

      export type TestSubNullableFilters = ColumnParam<\\"id\\", number | number[]> &
        ColumnParam<\\"parentId\\", TestFilters['id'] | null> &
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
          include: 'parent'[];
          sort: 'id' | '-id' | 'parentId' | '-parentId' | 'arr' | '-arr' | ('id' | '-id' | 'parentId' | '-parentId' | 'arr' | '-arr')[];
        };
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
      "type CollectionParams = {
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

      export type Test = {
        id: number;
        isBoolean: boolean;
        numberCount: number;
        text: string;
        typeId: string;
        getOtherThing: unknown;
        getThing: unknown;
      };

      export type TestFilters = ColumnParam<\\"id\\", number | number[]> &
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
          include: ('getThing' | 'getOtherThing')[];
          sort: 'id' | '-id' | 'isBoolean' | '-isBoolean' | 'numberCount' | '-numberCount' | 'text' | '-text' | 'typeId' | '-typeId' | ('id' | '-id' | 'isBoolean' | '-isBoolean' | 'numberCount' | '-numberCount' | 'text' | '-text' | 'typeId' | '-typeId')[];
        };
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
      "type CollectionParams = {
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

      export type Test = {
        id: number;
        isBoolean: boolean;
        numberCount: number;
        text: string;
        typeId: \\"type1\\" | \\"type2\\" | \\"type3\\";
        type: Type;
      };

      export type TestFilters = ColumnParam<\\"id\\", number | number[]> &
        ColumnParam<\\"isBoolean\\", boolean | boolean[]> &
        ColumnParam<\\"numberCount\\", number | number[]> &
        ColumnParam<\\"text\\", string | string[]> &
        ColumnParam<\\"typeId\\", TypeFilters['id']> & {
          type: TypeFilters;
          \\"type.not\\": TypeFilters;
          and: TestFilters | TestFilters[];
          \\"not.and\\": TestFilters | TestFilters[];
          or: TestFilters | TestFilters[];
          \\"not.or\\": TestFilters | TestFilters[];
        };

      export type TestParams = TestFilters &
        CollectionParams & {
          include: 'type'[];
          sort: 'id' | '-id' | 'isBoolean' | '-isBoolean' | 'numberCount' | '-numberCount' | 'text' | '-text' | 'typeId' | '-typeId' | ('id' | '-id' | 'isBoolean' | '-isBoolean' | 'numberCount' | '-numberCount' | 'text' | '-text' | 'typeId' | '-typeId')[];
        };

      export type Type = {
        id: \\"type1\\" | \\"type2\\" | \\"type3\\";
        test: Test[];
      };

      export type TypeFilters = ColumnParam<\\"id\\", (\\"type1\\" | \\"type2\\" | \\"type3\\")> & {
          and: TypeFilters | TypeFilters[];
          \\"not.and\\": TypeFilters | TypeFilters[];
          or: TypeFilters | TypeFilters[];
          \\"not.or\\": TypeFilters | TypeFilters[];
        };

      export type TypeParams = TypeFilters &
        CollectionParams & {
          include: 'test'[];
          sort: 'id' | '-id' | ('id' | '-id')[];
        };
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
      "type CollectionParams = {
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

      export type Test = {
        id: number;
        isBoolean: boolean;
        numberCount: number;
        text: string;
        typeId: string;
        type: Type;
      };

      export type TestFilters = ColumnParam<\\"id\\", number | number[]> &
        ColumnParam<\\"isBoolean\\", boolean | boolean[]> &
        ColumnParam<\\"numberCount\\", number | number[]> &
        ColumnParam<\\"text\\", string | string[]> &
        ColumnParam<\\"typeId\\", TypeFilters['id']> & {
          type: TypeFilters;
          \\"type.not\\": TypeFilters;
          and: TestFilters | TestFilters[];
          \\"not.and\\": TestFilters | TestFilters[];
          or: TestFilters | TestFilters[];
          \\"not.or\\": TestFilters | TestFilters[];
        };

      export type TestParams = TestFilters &
        CollectionParams & {
          include: 'type'[];
          sort: 'id' | '-id' | 'isBoolean' | '-isBoolean' | 'numberCount' | '-numberCount' | 'text' | '-text' | 'typeId' | '-typeId' | ('id' | '-id' | 'isBoolean' | '-isBoolean' | 'numberCount' | '-numberCount' | 'text' | '-text' | 'typeId' | '-typeId')[];
        };

      export type Type = {
        id: string;
        test: Test[];
      };

      export type TypeFilters = ColumnParam<\\"id\\", string | string[]> & {
          and: TypeFilters | TypeFilters[];
          \\"not.and\\": TypeFilters | TypeFilters[];
          or: TypeFilters | TypeFilters[];
          \\"not.or\\": TypeFilters | TypeFilters[];
        };

      export type TypeParams = TypeFilters &
        CollectionParams & {
          include: 'test'[];
          sort: 'id' | '-id' | ('id' | '-id')[];
        };
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

      type Optional<T, K extends keyof T> = Omit<T, K> & Partial<T>;

      declare module 'knex/types/tables' {
        interface Tables {
          \\"saveTestTable\\": Knex.CompositeTableType<
            SaveTestTable,
            Optional<SaveTestTable, \\"id\\">,
            Partial<SaveTestTable>
          >;
          \\"public.saveTestTable\\": Knex.CompositeTableType<
            SaveTestTable,
            Optional<SaveTestTable, \\"id\\">,
            Partial<SaveTestTable>
          >;
          \\"saveTest.lookupTable\\": Knex.CompositeTableType<
            LookupTable,
            LookupTable,
            Partial<LookupTable>
          >;
          \\"saveTest.test\\": Knex.CompositeTableType<
            Test,
            Optional<Test, \\"id\\" | \\"isBoolean\\" | \\"numberCount\\" | \\"text\\">,
            Partial<Test>
          >;
          \\"saveTest.testNullable\\": Knex.CompositeTableType<
            TestNullable,
            Optional<TestNullable, \\"id\\" | \\"isBoolean\\" | \\"numberCount\\" | \\"text\\">,
            Partial<TestNullable>
          >;
          \\"saveTest.testSub\\": Knex.CompositeTableType<
            TestSub,
            Optional<TestSub, \\"id\\" | \\"arr\\">,
            Partial<TestSub>
          >;
          \\"saveTest.testSubNullable\\": Knex.CompositeTableType<
            TestSubNullable,
            Optional<TestSubNullable, \\"id\\" | \\"parentId\\" | \\"arr\\">,
            Partial<TestSubNullable>
          >;
        }
      }

      export type SaveTestTable = {
        id: number;
        createdAt: Date;
        numberResponse: number;
      };

      export type LookupTable = {
        id: string;
      };

      export type Test = {
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
      "type CollectionParams = {
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

      export type Recursive = {
        id: number;
        parentId: number | null;
        parent?: Recursive;
        recursive: Recursive[];
      };

      export type RecursiveFilters = ColumnParam<\\"id\\", number | number[]> &
        ColumnParam<\\"parentId\\", number | number[] | null> & {
          parent: RecursiveFilters;
          \\"parent.not\\": RecursiveFilters;
          and: RecursiveFilters | RecursiveFilters[];
          \\"not.and\\": RecursiveFilters | RecursiveFilters[];
          or: RecursiveFilters | RecursiveFilters[];
          \\"not.or\\": RecursiveFilters | RecursiveFilters[];
        };

      export type RecursiveParams = RecursiveFilters &
        CollectionParams & {
          include: ('recursive' | 'parent')[];
          sort: 'id' | '-id' | 'parentId' | '-parentId' | ('id' | '-id' | 'parentId' | '-parentId')[];
        };
      "
    `);
  });
});
