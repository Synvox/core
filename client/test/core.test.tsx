import Knex from "knex";
import { createServer } from "http";
import testListen from "test-listen";
import express, { Application } from "express";
import Axios from "axios";
import { Core, knexHelpers } from "@synvox/core";
import { renderHook } from "@testing-library/react-hooks";
import { act } from "react-dom/test-utils";
import pg from "pg";
import { core as coreClient, table } from "../src";

pg.types.setTypeParser(20, "text", Number);

Axios.defaults.adapter = require("axios/lib/adapters/http");

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
    drop schema if exists core_test cascade;
    create schema core_test;
  `);
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

describe("core", () => {
  beforeEach(async () => {
    await knex.schema.withSchema("core_test").createTable("test", (t) => {
      t.bigIncrements("id").primary();
      t.boolean("is_boolean").notNullable().defaultTo(false);
      t.integer("number_count").notNullable().defaultTo(0);
      t.specificType("text", "character varying(10)")
        .notNullable()
        .defaultTo("text");
    });
    await knex.schema.withSchema("core_test").createTable("test_sub", (t) => {
      t.bigIncrements("id").primary();
      t.bigInteger("parent_id")
        .references("id")
        .inTable("core_test.test")
        .notNullable();
    });
  });

  it("reads", async () => {
    await knex("coreTest.test").insert({});
    const core = new Core(knex, () => ({}));

    core.table({
      schemaName: "coreTest",
      tableName: "test",
    });

    core.table({
      schemaName: "coreTest",
      tableName: "testSub",
    });

    const app = express();
    app.use(core.router);
    const url = await listen(app);
    const axios = Axios.create({ baseURL: url });

    type Test = {
      id: number;
      isBoolean: boolean;
      numberCount: number;
      text: string;
      testSub: TestSub[];
    };
    type TestSub = {
      id: number;
      parentId: number;
    };

    const { useCore, touch } = coreClient(axios, {
      test: table<Test, any>("/coreTest/test"),
      testSub: table<TestSub>("/coreTest/testSub"),
    });

    const { result, waitForNextUpdate, rerender } = renderHook(
      ({ id }: { id: number }) => {
        const core = useCore();
        const result = core.test(id, { include: "testSub" });
        return { result, testSub: result.testSub };
      },
      { initialProps: { id: 1 } }
    );

    expect(result.current).toMatchInlineSnapshot(`undefined`);
    await waitForNextUpdate();
    expect(result.current).toMatchInlineSnapshot(`
      Object {
        "result": Object {
          "_links": Object {
            "testSub": "/coreTest/testSub?parentId=1",
          },
          "_type": "coreTest/test",
          "_url": "/coreTest/test/1",
          "id": 1,
          "isBoolean": false,
          "numberCount": 0,
          "text": "text",
        },
        "testSub": Array [],
      }
    `);

    rerender({ id: 2 });
    await waitForNextUpdate();
    expect(result.error).toMatchInlineSnapshot(
      `[Error: Request failed with status code 404]`
    );

    await knex("coreTest.test").insert({});
    await act(async () => {
      await touch(() => true);
    });
    rerender({ id: 2 });
    await waitForNextUpdate();
    expect(result.current).toMatchInlineSnapshot(`
      Object {
        "result": Object {
          "_links": Object {
            "testSub": "/coreTest/testSub?parentId=2",
          },
          "_type": "coreTest/test",
          "_url": "/coreTest/test/2",
          "id": 2,
          "isBoolean": false,
          "numberCount": 0,
          "text": "text",
        },
        "testSub": Array [],
      }
    `);

    await knex("coreTest.testSub").insert({ parentId: 2 });
    await act(async () => {
      await touch(() => true);
    });
    rerender({ id: 2 });

    expect(await knex("coreTest.testSub")).toMatchInlineSnapshot(`
      Array [
        Object {
          "id": 1,
          "parentId": 2,
        },
      ]
    `);
    expect(result.current).toMatchInlineSnapshot(`
      Object {
        "result": Object {
          "_links": Object {
            "testSub": "/coreTest/testSub?parentId=2",
          },
          "_type": "coreTest/test",
          "_url": "/coreTest/test/2",
          "id": 2,
          "isBoolean": false,
          "numberCount": 0,
          "text": "text",
        },
        "testSub": Array [
          Object {
            "_links": Object {
              "parent": "/coreTest/test/2",
            },
            "_type": "coreTest/testSub",
            "_url": "/coreTest/testSub/1",
            "id": 1,
            "parentId": 2,
          },
        ],
      }
    `);
    {
      const {
        result: result,
        waitForNextUpdate: waitForNextUpdate,
      } = renderHook(() => {
        const core = useCore();
        const result = core.test({ isBoolean: true });
        return result;
      });
      await waitForNextUpdate();
      expect(result.current).toMatchInlineSnapshot(`Array []`);
    }
    {
      const {
        result: result,
        waitForNextUpdate: waitForNextUpdate,
      } = renderHook(() => {
        const core = useCore();
        const result = core.test({ isBoolean: false });
        return result;
      });
      await waitForNextUpdate();
      expect(result.current).toMatchInlineSnapshot(`
        Array [
          Object {
            "_links": Object {
              "testSub": "/coreTest/testSub?parentId=1",
            },
            "_type": "coreTest/test",
            "_url": "/coreTest/test/1",
            "id": 1,
            "isBoolean": false,
            "numberCount": 0,
            "text": "text",
          },
          Object {
            "_links": Object {
              "testSub": "/coreTest/testSub?parentId=2",
            },
            "_type": "coreTest/test",
            "_url": "/coreTest/test/2",
            "id": 2,
            "isBoolean": false,
            "numberCount": 0,
            "text": "text",
          },
        ]
      `);
    }
    {
      const {
        result: result,
        waitForNextUpdate: waitForNextUpdate,
      } = renderHook(() => {
        const core = useCore();
        const result = core.test();
        return result;
      });
      await waitForNextUpdate();
      expect(result.current).toMatchInlineSnapshot(`
        Array [
          Object {
            "_links": Object {
              "testSub": "/coreTest/testSub?parentId=1",
            },
            "_type": "coreTest/test",
            "_url": "/coreTest/test/1",
            "id": 1,
            "isBoolean": false,
            "numberCount": 0,
            "text": "text",
          },
          Object {
            "_links": Object {
              "testSub": "/coreTest/testSub?parentId=2",
            },
            "_type": "coreTest/test",
            "_url": "/coreTest/test/2",
            "id": 2,
            "isBoolean": false,
            "numberCount": 0,
            "text": "text",
          },
        ]
      `);
    }
  });

  it("writes", async () => {
    const core = new Core(knex, () => ({}));

    core.table({
      schemaName: "coreTest",
      tableName: "test",
    });

    core.table({
      schemaName: "coreTest",
      tableName: "testSub",
    });

    const app = express();
    app.use(core.router);
    const url = await listen(app);
    const axios = Axios.create({ baseURL: url });

    type Test = {
      id: number;
      isBoolean: boolean;
      numberCount: number;
      text: string;
      testSub: TestSub[];
    };
    type TestSub = {
      id: number;
      parentId: number;
    };

    const { useCore } = coreClient(axios, {
      test: table<Test, any>("/coreTest/test"),
      testSub: table<TestSub>("/coreTest/testSub"),
    });

    const { result } = renderHook(() => {
      const core = useCore();
      return core;
    });

    expect(await result.current.test.post({})).toMatchInlineSnapshot(`
      Object {
        "changes": Array [
          Object {
            "mode": "insert",
            "path": "coreTest/test",
            "row": Object {
              "_links": Object {
                "testSub": "/coreTest/testSub?parentId=1",
              },
              "_type": "coreTest/test",
              "_url": "/coreTest/test/1",
              "id": 1,
              "isBoolean": false,
              "numberCount": 0,
              "text": "text",
            },
          },
        ],
        "data": Object {
          "_links": Object {
            "testSub": "/coreTest/testSub?parentId=1",
          },
          "_type": "coreTest/test",
          "_url": "/coreTest/test/1",
          "id": 1,
          "isBoolean": false,
          "numberCount": 0,
          "text": "text",
        },
      }
    `);

    expect(await result.current.test.put(1, { isBoolean: true }))
      .toMatchInlineSnapshot(`
      Object {
        "changes": Array [
          Object {
            "mode": "update",
            "path": "coreTest/test",
            "row": Object {
              "_links": Object {
                "testSub": "/coreTest/testSub?parentId=1",
              },
              "_type": "coreTest/test",
              "_url": "/coreTest/test/1",
              "id": 1,
              "isBoolean": true,
              "numberCount": 0,
              "text": "text",
            },
          },
        ],
        "data": Object {
          "_links": Object {
            "testSub": "/coreTest/testSub?parentId=1",
          },
          "_type": "coreTest/test",
          "_url": "/coreTest/test/1",
          "id": 1,
          "isBoolean": true,
          "numberCount": 0,
          "text": "text",
        },
      }
    `);

    expect(await result.current.test.delete(1)).toMatchInlineSnapshot(`
      Object {
        "changes": Array [
          Object {
            "mode": "delete",
            "path": "coreTest/test",
            "row": Object {
              "_links": Object {
                "testSub": "/coreTest/testSub?parentId=1",
              },
              "_type": "coreTest/test",
              "_url": "/coreTest/test/1",
              "id": 1,
              "isBoolean": true,
              "numberCount": 0,
              "text": "text",
            },
          },
        ],
        "data": null,
      }
    `);
  });
});
