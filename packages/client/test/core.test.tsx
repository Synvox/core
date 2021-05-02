import Knex from "knex";
import { createServer } from "http";
import testListen from "test-listen";
import express, { Application } from "express";
import Axios from "axios";
import { Core, knexHelpers } from "@synvox/core";
import { renderHook } from "@testing-library/react-hooks";
import { act } from "react-dom/test-utils";
import pg from "pg";
import { core as coreClient, table, AxiosConfigProvider } from "../src";
import EventSource from "eventsource";
import uuid from "uuid";

//@ts-expect-error
global.EventSource = EventSource;

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
    drop schema if exists core_client_test cascade;
    create schema core_client_test;
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

describe("core", () => {
  beforeEach(async () => {
    await knex.schema
      .withSchema("core_client_test")
      .createTable("test", (t) => {
        t.bigIncrements("id").primary();
        t.boolean("is_boolean").notNullable().defaultTo(false);
        t.integer("number_count").notNullable().defaultTo(0);
        t.specificType("text", "character varying(10)")
          .notNullable()
          .defaultTo("text");
      });
    await knex.schema
      .withSchema("core_client_test")
      .createTable("test_sub", (t) => {
        t.bigIncrements("id").primary();
        t.bigInteger("parent_id")
          .references("id")
          .inTable("core_client_test.test")
          .notNullable();
      });
  });

  it("reads", async () => {
    await knex("coreClientTest.test").insert({});
    const core = new Core(knex, () => ({}));

    core.table({
      schemaName: "coreClientTest",
      tableName: "test",
    });

    core.table({
      schemaName: "coreClientTest",
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
      test: table<Test, Test & { include: "testSub" }>("/coreClientTest/test"),
      testSub: table<TestSub, TestSub>("/coreClientTest/testSub"),
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
    //@ts-expect-error
    expect(result.current.result._links).toMatchInlineSnapshot(`
      Object {
        "testSub": "/coreClientTest/testSub?parentId=1",
        "testSubCount": "/coreClientTest/test/1/testSubCount",
      }
    `);
    //@ts-expect-error
    expect(result.current.result._type).toMatchInlineSnapshot(
      `"coreClientTest/test"`
    );
    //@ts-expect-error
    expect(result.current.result._url).toMatchInlineSnapshot(
      `"/coreClientTest/test/1"`
    );
    expect(result.current).toMatchInlineSnapshot(`
      Object {
        "result": Object {
          "id": 1,
          "isBoolean": false,
          "numberCount": 0,
          "testSub": Array [],
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

    await knex("coreClientTest.test").insert({});
    await act(async () => {
      await touch(() => true);
    });
    rerender({ id: 2 });
    await waitForNextUpdate();
    expect(result.current).toMatchInlineSnapshot(`
      Object {
        "result": Object {
          "id": 2,
          "isBoolean": false,
          "numberCount": 0,
          "testSub": Array [],
          "text": "text",
        },
        "testSub": Array [],
      }
    `);

    await knex("coreClientTest.testSub").insert({ parentId: 2 });
    await act(async () => {
      await touch(() => true);
    });
    rerender({ id: 2 });

    expect(result.current).toMatchInlineSnapshot(`
      Object {
        "result": Object {
          "id": 2,
          "isBoolean": false,
          "numberCount": 0,
          "testSub": Array [
            Object {
              "id": 1,
              "parentId": 2,
            },
          ],
          "text": "text",
        },
        "testSub": Array [
          Object {
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
      expect(result.current.hasMore).toMatchInlineSnapshot(`false`);
      expect(result.current.page).toMatchInlineSnapshot(`0`);
      expect(result.current.limit).toMatchInlineSnapshot(`50`);
      expect(result.current).toMatchInlineSnapshot(`
        Array [
          Object {
            "id": 1,
            "isBoolean": false,
            "numberCount": 0,
            "text": "text",
          },
          Object {
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
            "id": 1,
            "isBoolean": false,
            "numberCount": 0,
            "text": "text",
          },
          Object {
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
      schemaName: "coreClientTest",
      tableName: "test",
      maxBulkUpdates: 100,
    });

    core.table({
      schemaName: "coreClientTest",
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
      test: table<Test, Test>("/coreClientTest/test"),
      testSub: table<TestSub, any>("/coreClientTest/testSub"),
    });

    const { result, waitForNextUpdate } = renderHook(() => {
      const core = useCore();
      return {
        test: core.test(),
        core,
      };
    });

    expect(result.current).toMatchInlineSnapshot(`undefined`);
    await waitForNextUpdate();

    expect((await result.current.core.test.post({})).changes)
      .toMatchInlineSnapshot(`
      Array [
        Object {
          "mode": "insert",
          "path": "/coreClientTest/test",
          "row": Object {
            "_links": Object {
              "testSub": "/coreClientTest/testSub?parentId=1",
              "testSubCount": "/coreClientTest/test/1/testSubCount",
            },
            "_type": "coreClientTest/test",
            "_url": "/coreClientTest/test/1",
            "id": 1,
            "isBoolean": false,
            "numberCount": 0,
            "text": "text",
          },
        },
      ]
    `);

    expect((await result.current.core.test.put(1, { isBoolean: true })).changes)
      .toMatchInlineSnapshot(`
      Array [
        Object {
          "mode": "update",
          "path": "/coreClientTest/test",
          "row": Object {
            "_links": Object {
              "testSub": "/coreClientTest/testSub?parentId=1",
              "testSubCount": "/coreClientTest/test/1/testSubCount",
            },
            "_type": "coreClientTest/test",
            "_url": "/coreClientTest/test/1",
            "id": 1,
            "isBoolean": true,
            "numberCount": 0,
            "text": "text",
          },
        },
      ]
    `);

    expect(
      (
        await result.current.core.test.put(
          { isBoolean: true },
          { numberCount: 54321 }
        )
      ).changes
    ).toMatchInlineSnapshot(`
      Array [
        Object {
          "mode": "update",
          "path": "/coreClientTest/test",
          "row": Object {
            "id": 1,
            "isBoolean": true,
            "numberCount": 54321,
            "text": "text",
          },
        },
      ]
    `);

    expect((await result.current.core.test.delete(1)).changes)
      .toMatchInlineSnapshot(`
      Array [
        Object {
          "mode": "delete",
          "path": "/coreClientTest/test",
          "row": Object {
            "_links": Object {
              "testSub": "/coreClientTest/testSub?parentId=1",
              "testSubCount": "/coreClientTest/test/1/testSubCount",
            },
            "_type": "coreClientTest/test",
            "_url": "/coreClientTest/test/1",
            "id": 1,
            "isBoolean": true,
            "numberCount": 54321,
            "text": "text",
          },
        },
      ]
    `);

    const postAction = await result.current.core.test.post({});
    expect(postAction.changes).toMatchInlineSnapshot(`
      Array [
        Object {
          "mode": "insert",
          "path": "/coreClientTest/test",
          "row": Object {
            "_links": Object {
              "testSub": "/coreClientTest/testSub?parentId=2",
              "testSubCount": "/coreClientTest/test/2/testSubCount",
            },
            "_type": "coreClientTest/test",
            "_url": "/coreClientTest/test/2",
            "id": 2,
            "isBoolean": false,
            "numberCount": 0,
            "text": "text",
          },
        },
      ]
    `);

    await act(async () => {
      await postAction.update();
    });

    expect([...result.current.test]).toMatchInlineSnapshot(`
      Array [
        Object {
          "id": 2,
          "isBoolean": false,
          "numberCount": 0,
          "text": "text",
        },
      ]
    `);
  });

  it("can accept new params through a provider", async () => {
    await knex("coreClientTest.test").insert({});
    const core = new Core(knex, () => ({}));

    core.table({
      schemaName: "coreClientTest",
      tableName: "test",
    });

    core.table({
      schemaName: "coreClientTest",
      tableName: "testSub",
    });

    const app = express();
    app.use(core.router);
    const url = await listen(app);
    const axios = Axios.create({ baseURL: url });

    let urls: string[] = [];
    axios.interceptors.request.use((config) => {
      urls.push(`${config.method} ${config.url!}`);
      return config;
    });

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
      test: table<Test, Test & { include: "testSub" }>("/coreClientTest/test"),
      testSub: table<TestSub, any>("/coreClientTest/testSub"),
    });

    const { result, waitForNextUpdate } = renderHook(
      ({ id }: { id: number }) => {
        const core = useCore();
        const result = core.test(id, { include: "testSub" });
        return { result, core };
      },
      {
        initialProps: { id: 1 },
        wrapper: (p) => {
          return (
            <AxiosConfigProvider config={{ params: { orgId: 1 } }}>
              {p.children}
            </AxiosConfigProvider>
          );
        },
      }
    );

    expect(result.current).toMatchInlineSnapshot(`undefined`);
    await waitForNextUpdate();
    expect(urls).toMatchInlineSnapshot(`
      Array [
        "get /coreClientTest/test/1?include=testSub&orgId=1",
      ]
    `);
    expect(result.current).toMatchInlineSnapshot(`
      Object {
        "core": Object {
          "test": [Function],
          "testSub": [Function],
        },
        "result": Object {
          "id": 1,
          "isBoolean": false,
          "numberCount": 0,
          "testSub": Array [],
          "text": "text",
        },
      }
    `);

    urls = [];
    expect((await result.current.core.test.post({})).changes)
      .toMatchInlineSnapshot(`
      Array [
        Object {
          "mode": "insert",
          "path": "/coreClientTest/test",
          "row": Object {
            "_links": Object {
              "testSub": "/coreClientTest/testSub?parentId=2",
              "testSubCount": "/coreClientTest/test/2/testSubCount",
            },
            "_type": "coreClientTest/test",
            "_url": "/coreClientTest/test/2",
            "id": 2,
            "isBoolean": false,
            "numberCount": 0,
            "text": "text",
          },
        },
      ]
    `);

    expect(urls).toMatchInlineSnapshot(`
      Array [
        "post /coreClientTest/test?orgId=1",
      ]
    `);
  });

  it("reads using /first", async () => {
    await knex("coreClientTest.test").insert({});
    await knex("coreClientTest.testSub").insert({ parentId: 1 });
    const core = new Core(knex, () => ({}));

    core.table({
      schemaName: "coreClientTest",
      tableName: "test",
    });

    core.table({
      schemaName: "coreClientTest",
      tableName: "testSub",
    });

    const app = express();
    app.use(core.router);
    const url = await listen(app);
    const axios = Axios.create({ baseURL: url });

    let urls: string[] = [];
    axios.interceptors.request.use((config) => {
      urls.push(`${config.method} ${config.url!}`);
      return config;
    });

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
      test: table<Test, Test & { include: "testSub" }>("/coreClientTest/test"),
      testSub: table<TestSub, any>("/coreClientTest/testSub"),
    });

    const { result, waitForNextUpdate } = renderHook(
      ({ id }: { id: number }) => {
        const core = useCore();
        const result = core.test.first({ id, include: "testSub" });
        return { result };
      },
      {
        initialProps: { id: 1 },
      }
    );

    expect(result.current).toMatchInlineSnapshot(`undefined`);
    await waitForNextUpdate();
    expect(urls).toMatchInlineSnapshot(`
      Array [
        "get /coreClientTest/test/first?id=1&include=testSub",
      ]
    `);
    expect(result.current).toMatchInlineSnapshot(`
      Object {
        "result": Object {
          "id": 1,
          "isBoolean": false,
          "numberCount": 0,
          "testSub": Array [
            Object {
              "id": 1,
              "parentId": 1,
            },
          ],
          "text": "text",
        },
      }
    `);
  });

  it("can traverse links", async () => {
    await knex("coreClientTest.test").insert({});
    await knex("coreClientTest.testSub").insert({ parentId: 1 });
    const core = new Core(knex, () => ({}));

    core.table({
      schemaName: "coreClientTest",
      tableName: "test",
    });

    core.table({
      schemaName: "coreClientTest",
      tableName: "testSub",
    });

    const app = express();
    app.use(core.router);
    const url = await listen(app);
    const axios = Axios.create({ baseURL: url });

    let urls: string[] = [];
    axios.interceptors.request.use((config) => {
      urls.push(`${config.method} ${config.url!}`);
      return config;
    });

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
      test: table<Test, Test>("/coreClientTest/test"),
      testSub: table<TestSub, any>("/coreClientTest/testSub"),
    });

    const { result, waitForNextUpdate } = renderHook(
      ({ id }: { id: number }) => {
        const core = useCore();
        const result = core.test.first({ id }).testSub;
        return { result };
      },
      {
        initialProps: { id: 1 },
      }
    );

    expect(result.current).toMatchInlineSnapshot(`undefined`);
    await waitForNextUpdate();
    expect(urls).toMatchInlineSnapshot(`
      Array [
        "get /coreClientTest/test/first?id=1",
        "get /coreClientTest/testSub?parentId=1",
      ]
    `);
    expect(result.current).toMatchInlineSnapshot(`
      Object {
        "result": Array [
          Object {
            "id": 1,
            "parentId": 1,
          },
        ],
      }
    `);
  });

  it("reads using /count", async () => {
    await knex("coreClientTest.test").insert({});

    const core = new Core(knex, () => ({}));

    core.table({
      schemaName: "coreClientTest",
      tableName: "test",
    });

    const app = express();
    app.use(core.router);
    const url = await listen(app);
    const axios = Axios.create({ baseURL: url });

    let urls: string[] = [];
    axios.interceptors.request.use((config) => {
      urls.push(`${config.method} ${config.url!}`);
      return config;
    });

    type Test = {
      id: number;
      isBoolean: boolean;
      numberCount: number;
      text: string;
    };

    const { useCore } = coreClient(axios, {
      test: table<Test, any>("/coreClientTest/test"),
    });

    const { result, waitForNextUpdate } = renderHook(() => {
      const core = useCore();
      const result = core.test.count();
      return { result };
    });

    expect(result.current).toMatchInlineSnapshot(`undefined`);
    await waitForNextUpdate();
    expect(urls).toMatchInlineSnapshot(`
      Array [
        "get /coreClientTest/test/count",
      ]
    `);
    expect(result.current).toMatchInlineSnapshot(`
      Object {
        "result": 1,
      }
    `);
  });

  it("reads using /ids", async () => {
    await knex("coreClientTest.test").insert({});

    const core = new Core(knex, () => ({}));

    core.table({
      schemaName: "coreClientTest",
      tableName: "test",
    });

    const app = express();
    app.use(core.router);
    const url = await listen(app);
    const axios = Axios.create({ baseURL: url });

    let urls: string[] = [];
    axios.interceptors.request.use((config) => {
      urls.push(`${config.method} ${config.url!}`);
      return config;
    });

    type Test = {
      id: number;
      isBoolean: boolean;
      numberCount: number;
      text: string;
    };

    const { useCore } = coreClient(axios, {
      test: table<Test, any>("/coreClientTest/test"),
    });

    const { result, waitForNextUpdate } = renderHook(() => {
      const core = useCore();
      const result = core.test.ids();
      return { result };
    });

    expect(result.current).toMatchInlineSnapshot(`undefined`);
    await waitForNextUpdate();
    expect(urls).toMatchInlineSnapshot(`
      Array [
        "get /coreClientTest/test/ids",
      ]
    `);
    expect(result.current).toMatchInlineSnapshot(`
      Object {
        "result": Array [
          1,
        ],
      }
    `);
  });

  it("works with sse", async () => {
    await knex("coreClientTest.test").insert({});

    const core = new Core(knex, () => ({}));

    core.table({
      schemaName: "coreClientTest",
      tableName: "test",
    });

    const app = express();
    app.use("/sse", core.sse());
    app.use(core.router);
    const url = await listen(app);
    const axios = Axios.create({ baseURL: url });

    let urls: string[] = [];
    axios.interceptors.request.use((config) => {
      urls.push(`${config.method} ${config.url!}`);
      return config;
    });

    type Test = {
      id: number;
      isBoolean: boolean;
      numberCount: number;
      text: string;
    };

    const { useCore, sse } = coreClient(axios, {
      test: table<Test, any>("/coreClientTest/test"),
    });

    const eventSource = sse(`${url}/sse`);

    const { result, waitForNextUpdate } = renderHook(() => {
      const core = useCore();
      const result = core.test();

      return { result, core };
    });

    expect(result.current).toMatchInlineSnapshot(`undefined`);
    await waitForNextUpdate();
    expect(urls).toMatchInlineSnapshot(`
      Array [
        "get /coreClientTest/test",
      ]
    `);
    expect(result.current).toMatchInlineSnapshot(`
      Object {
        "core": Object {
          "test": [Function],
        },
        "result": Array [
          Object {
            "id": 1,
            "isBoolean": false,
            "numberCount": 0,
            "text": "text",
          },
        ],
      }
    `);

    urls = [];
    await axios.post("/coreClientTest/test", {});
    await waitForNextUpdate();
    expect(urls).toMatchInlineSnapshot(`
      Array [
        "post /coreClientTest/test",
        "get /coreClientTest/test",
      ]
    `);
    expect(result.current).toMatchInlineSnapshot(`
      Object {
        "core": Object {
          "test": [Function],
        },
        "result": Array [
          Object {
            "id": 1,
            "isBoolean": false,
            "numberCount": 0,
            "text": "text",
          },
          Object {
            "id": 2,
            "isBoolean": false,
            "numberCount": 0,
            "text": "text",
          },
        ],
      }
    `);

    const { update, changes } = await result.current.core.test.post({});
    expect(changes).toMatchInlineSnapshot(`
      Array [
        Object {
          "mode": "insert",
          "path": "/coreClientTest/test",
          "row": Object {
            "_links": Object {},
            "_type": "coreClientTest/test",
            "_url": "/coreClientTest/test/3",
            "id": 3,
            "isBoolean": false,
            "numberCount": 0,
            "text": "text",
          },
        },
      ]
    `);

    await act(async () => {
      await update();
    });

    expect(result.current).toMatchInlineSnapshot(`
      Object {
        "core": Object {
          "test": [Function],
        },
        "result": Array [
          Object {
            "id": 1,
            "isBoolean": false,
            "numberCount": 0,
            "text": "text",
          },
          Object {
            "id": 2,
            "isBoolean": false,
            "numberCount": 0,
            "text": "text",
          },
          Object {
            "id": 3,
            "isBoolean": false,
            "numberCount": 0,
            "text": "text",
          },
        ],
      }
    `);

    eventSource.close();
  });
});