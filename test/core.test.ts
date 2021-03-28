import Knex from "knex";
import { EventEmitter } from "events";
import { createServer } from "http";
import testListen from "test-listen";
import express, { Application } from "express";
import Axios from "axios";
import EventSource from "eventsource";
import { knexHelpers, Core, StatusError, ChangeSummary } from "../src";
import compression from "compression";

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

describe("listens on server", () => {
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

    const core = new Core(
      knex,
      () => ({}),

      {
        baseUrl: "http://localhost",
      }
    );

    core.table({
      schemaName: "coreTest",
      tableName: "test",
    });

    const app = express();
    app.use(core.router);
    const url = await listen(app);

    const axios = Axios.create({ baseURL: url });

    expect((await axios.get("/coreTest/test").catch((e) => e.response)).data)
      .toMatchInlineSnapshot(`
      Object {
        "_links": Object {
          "collection": Object {
            "href": "http://localhost/coreTest/test",
          },
          "count": Object {
            "href": "http://localhost/coreTest/test/count",
          },
          "ids": Object {
            "href": "http://localhost/coreTest/test/ids",
          },
          "self": Object {
            "href": "http://localhost/coreTest/test",
          },
        },
        "hasMore": false,
        "items": Array [
          Object {
            "_links": Object {
              "collection": Object {
                "href": "http://localhost/coreTest/test",
              },
              "self": Object {
                "href": "http://localhost/coreTest/test/1",
              },
            },
            "id": 1,
            "isBoolean": false,
            "numberCount": 0,
            "text": "text",
          },
        ],
        "limit": 50,
        "page": 0,
      }
    `);
  });

  it("reads by id", async () => {
    const [row] = await knex("coreTest.test").insert({}).returning("*");

    const core = new Core(
      async () => knex,
      () => ({})
    );

    core.table({
      schemaName: "coreTest",
      tableName: "test",
    });

    const app = express();
    app.use(core.router);
    const url = await listen(app);

    const axios = Axios.create({ baseURL: url });

    expect(
      (await axios.get(`/coreTest/test/${row.id}`).catch((e) => e.response))
        .data
    ).toMatchInlineSnapshot(`
      Object {
        "data": Object {
          "_links": Object {
            "collection": Object {
              "href": "/coreTest/test",
            },
            "self": Object {
              "href": "/coreTest/test/1",
            },
          },
          "id": 1,
          "isBoolean": false,
          "numberCount": 0,
          "text": "text",
        },
      }
    `);
  });

  it("inserts", async () => {
    const core = new Core(knex, () => ({}));

    core.table({
      schemaName: "coreTest",
      tableName: "test",
    });

    const app = express();
    app.use(core.router);
    const url = await listen(app);

    const axios = Axios.create({ baseURL: url });

    await core.init();

    queries = [];
    expect(
      (
        await axios
          .post("/coreTest/test", {
            isBoolean: true,
            numberCount: 10,
            text: "abc",
          })
          .catch((e) => e.response)
      ).data
    ).toMatchInlineSnapshot(`
      Object {
        "changes": Array [
          Object {
            "mode": "insert",
            "row": Object {
              "id": 1,
              "isBoolean": true,
              "numberCount": 10,
              "text": "abc",
            },
            "schemaName": "coreTest",
            "tableName": "test",
          },
        ],
        "data": Object {
          "_links": Object {
            "collection": Object {
              "href": "/coreTest/test",
            },
            "self": Object {
              "href": "/coreTest/test/1",
            },
          },
          "id": 1,
          "isBoolean": true,
          "numberCount": 10,
          "text": "abc",
        },
      }
    `);
    expect(queries).toMatchInlineSnapshot(`
      Array [
        "insert into core_test.test (is_boolean, number_count, text) values (?, ?, ?) returning *",
        "select test.id, test.is_boolean, test.number_count, test.text from core_test.test where test.id = ? limit ?",
      ]
    `);
  });

  it("updates", async () => {
    const [row] = await knex("coreTest.test").insert({}).returning("*");

    const core = new Core(knex, () => ({}));

    core.table({
      schemaName: "coreTest",
      tableName: "test",
    });

    const app = express();
    app.use(core.router);
    const url = await listen(app);

    const axios = Axios.create({ baseURL: url });

    expect(
      (
        await axios
          .put(`/coreTest/test/${row.id}`, {
            id: 123,
            numberCount: 10,
            isBoolean: true,
            text: "abc",
          })
          .catch((e) => e.response)
      ).data
    ).toMatchInlineSnapshot(`
      Object {
        "changes": Array [
          Object {
            "mode": "update",
            "row": Object {
              "_links": Object {
                "collection": Object {
                  "href": "/coreTest/test",
                },
                "self": Object {
                  "href": "/coreTest/test/1",
                },
              },
              "id": 1,
              "isBoolean": true,
              "numberCount": 10,
              "text": "abc",
            },
            "schemaName": "coreTest",
            "tableName": "test",
          },
        ],
        "data": Object {
          "_links": Object {
            "collection": Object {
              "href": "/coreTest/test",
            },
            "self": Object {
              "href": "/coreTest/test/1",
            },
          },
          "id": 1,
          "isBoolean": true,
          "numberCount": 10,
          "text": "abc",
        },
      }
    `);
  });

  it("validates", async () => {
    const [row] = await knex("coreTest.test").insert({}).returning("*");

    const core = new Core(knex, () => ({}));

    core.table({
      schemaName: "coreTest",
      tableName: "test",
    });

    const app = express();
    app.use(core.router);
    const url = await listen(app);

    const axios = Axios.create({ baseURL: url });

    expect(
      (
        await axios
          .put(`/coreTest/test/${row.id}`, {
            numberCount: "not a number",
          })
          .catch((e) => e.response)
      ).data
    ).toMatchInlineSnapshot(`
      Object {
        "errors": Object {
          "numberCount": "must be a \`number\` type, but the final value was: \`NaN\` (cast from the value \`\\"not a number\\"\`).",
        },
      }
    `);
  });

  it("closes connection on unknown error", async () => {
    const [row] = await knex("coreTest.test").insert({}).returning("*");

    const core = new Core(knex, () => ({}));

    core.table({
      schemaName: "coreTest",
      tableName: "test",
      afterUpdate() {
        throw new Error("err");
      },
    });

    const app = express();
    app.use(core.router);
    const url = await listen(app);

    const axios = Axios.create({ baseURL: url });

    expect(
      (
        await axios
          .put(`/coreTest/test/${row.id}`, { isBoolean: true })
          .catch((e) => e.response)
      ).status
    ).toMatchInlineSnapshot(`500`);
  });

  it("closes connection on status error", async () => {
    const [row] = await knex("coreTest.test").insert({}).returning("*");

    const core = new Core(knex, () => ({}));

    core.table({
      schemaName: "coreTest",
      tableName: "test",
      afterUpdate() {
        const err = new StatusError("err");
        err.statusCode = 409;
        throw err;
      },
    });

    const app = express();
    app.use(core.router);
    const url = await listen(app);

    const axios = Axios.create({ baseURL: url });

    expect(
      (
        await axios
          .put(`/coreTest/test/${row.id}`, { isBoolean: true })
          .catch((e) => e.response)
      ).status
    ).toMatchInlineSnapshot(`409`);
  });

  it("does not release stack trace in production", async () => {
    const env = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    const [row] = await knex("coreTest.test").insert({}).returning("*");

    const core = new Core(knex, () => ({}));

    core.table({
      schemaName: "coreTest",
      tableName: "test",
      afterUpdate() {
        const err = new StatusError("err");
        err.statusCode = 409;
        throw err;
      },
    });

    const app = express();
    app.use(core.router);
    const url = await listen(app);

    const axios = Axios.create({ baseURL: url });

    expect(
      (
        await axios
          .put(`/coreTest/test/${row.id}`, { isBoolean: true })
          .catch((e) => e.response)
      ).data
    ).toMatchInlineSnapshot(`
      Object {
        "error": "An error occurred",
      }
    `);
    process.env.NODE_ENV = env;
  });

  it("deletes", async () => {
    const [row] = await knex("coreTest.test").insert({}).returning("*");

    const core = new Core(knex, () => ({}));

    core.table({
      schemaName: "coreTest",
      tableName: "test",
    });

    const app = express();
    app.use(core.router);
    const url = await listen(app);

    const axios = Axios.create({ baseURL: url });

    expect(
      (await axios.delete(`/coreTest/test/${row.id}`).catch((e) => e.response))
        .data
    ).toMatchInlineSnapshot(`
      Object {
        "changes": Array [
          Object {
            "mode": "delete",
            "row": Object {
              "id": 1,
              "isBoolean": false,
              "numberCount": 0,
              "text": "text",
            },
            "schemaName": "coreTest",
            "tableName": "test",
          },
        ],
        "data": null,
      }
    `);
  });

  it("gets getters", async () => {
    const [row] = await knex("coreTest.test").insert({}).returning("*");
    await knex("coreTest.testSub").insert({ parentId: row.id }).returning("*");

    const core = new Core(knex, () => ({}));

    core.table({
      schemaName: "coreTest",
      tableName: "test",
      eagerGetters: {
        async subCount(stmt) {
          stmt
            .from("coreTest.testSub")
            .count()
            .first()
            .whereRaw("test_sub.parent_id = ??", [`${this.alias}.id`]);
        },
      },
    });

    core.table({
      schemaName: "coreTest",
      tableName: "testSub",
    });

    const app = express();
    app.use(core.router);
    const url = await listen(app);

    const axios = Axios.create({ baseURL: url });

    expect(
      (
        await axios
          .get(`/coreTest/test/${row.id}/subCount`)
          .catch((e) => e.response)
      ).data
    ).toMatchInlineSnapshot(`
      Object {
        "data": Object {
          "count": 1,
        },
        "meta": Object {
          "_url": "/coreTest/test/1/subCount",
        },
      }
    `);
  });

  it("gets ids", async () => {
    await knex("coreTest.test").insert({}).returning("*");

    const core = new Core(knex, () => ({}));

    core.table({
      schemaName: "coreTest",
      tableName: "test",
    });

    const app = express();
    app.use(core.router);
    const url = await listen(app);

    const axios = Axios.create({ baseURL: url });

    expect(
      (await axios.get(`/coreTest/test/ids`).catch((e) => e.response)).data
    ).toMatchInlineSnapshot(`
      Object {
        "_links": Object {
          "collection": Object {
            "href": "/coreTest/test",
          },
          "nextPage": Object {
            "href": "/coreTest/test/ids?page=1",
          },
          "previousPage": Object {
            "href": "/coreTest/test/ids?page=-1",
          },
          "self": Object {
            "href": "/coreTest/test/ids",
          },
        },
        "hasMore": false,
        "items": Array [
          null,
        ],
        "limit": 1000,
        "page": 0,
      }
    `);
  });

  it("gets count", async () => {
    await knex("coreTest.test").insert({}).returning("*");

    const core = new Core(knex, () => ({}));

    core.table({
      schemaName: "coreTest",
      tableName: "test",
    });

    const app = express();
    app.use(core.router);
    const url = await listen(app);

    const axios = Axios.create({ baseURL: url });

    expect(
      (await axios.get(`/coreTest/test/count`).catch((e) => e.response)).data
    ).toMatchInlineSnapshot(`
      Object {
        "data": 1,
        "meta": Object {
          "_url": "/coreTest/test/count",
        },
      }
    `);
  });

  it("initializes once", async () => {
    await knex("coreTest.test").insert({}).returning("*");

    const core = new Core(knex, () => ({}));

    core.table({
      schemaName: "coreTest",
      tableName: "test",
    });

    const app = express();
    app.use(core.router);

    const url = await listen(app);

    const axios = Axios.create({ baseURL: url });

    await Promise.all([
      axios.get(`/coreTest/test`),
      axios.get(`/coreTest/test`),
    ]);
    queries = [];
    await axios.get(`/coreTest/test`);
    expect(queries).toMatchInlineSnapshot(`
      Array [
        "select test.id, test.is_boolean, test.number_count, test.text from core_test.test order by test.id asc limit ?",
      ]
    `);
  });
});

describe("forwards params", () => {
  beforeEach(async () => {
    await knex.schema.withSchema("core_test").createTable("orgs", (t) => {
      t.bigIncrements("id").primary();
    });
    await knex.schema.withSchema("core_test").createTable("test", (t) => {
      t.bigIncrements("id").primary();
      t.bigInteger("orgId")
        .references("id")
        .inTable("coreTest.orgs")
        .notNullable();
    });
  });

  it("gets tenant id", async () => {
    const [org] = await knex("coreTest.orgs").insert({}).returning("*");
    await knex("coreTest.test").insert({ orgId: org.id });

    type Context = {};

    const core = new Core<Context>(knex, () => {
      return {};
    });

    core.table({
      schemaName: "coreTest",
      tableName: "test",
      tenantIdColumnName: "orgId",
    });

    const app = express();
    app.use("/:orgId", core.router);
    const url = await listen(app);

    const axios = Axios.create({ baseURL: url });

    expect(
      (await axios.get(`/${org.id}/coreTest/test`).catch((e) => e.response))
        .data
    ).toMatchInlineSnapshot(`
      Object {
        "_links": Object {
          "collection": Object {
            "href": "/coreTest/test",
          },
          "count": Object {
            "href": "/coreTest/test/count?orgId=1",
          },
          "ids": Object {
            "href": "/coreTest/test/ids?orgId=1",
          },
          "self": Object {
            "href": "/coreTest/test?orgId=1",
          },
        },
        "hasMore": false,
        "items": Array [
          Object {
            "_links": Object {
              "collection": Object {
                "href": "/coreTest/test",
              },
              "self": Object {
                "href": "/coreTest/test/1?orgId=1",
              },
            },
            "id": 1,
            "orgId": 1,
          },
        ],
        "limit": 50,
        "page": 0,
      }
    `);
  });
});

describe("sse", () => {
  beforeEach(async () => {
    await knex.schema.withSchema("core_test").createTable("orgs", (t) => {
      t.bigIncrements("id").primary();
    });
    await knex.schema.withSchema("core_test").createTable("test", (t) => {
      t.bigIncrements("id").primary();
      t.bigInteger("orgId")
        .references("id")
        .inTable("coreTest.orgs")
        .notNullable();
    });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("provides an sse endpoint", async () => {
    const [org] = await knex("coreTest.orgs").insert({}).returning("*");
    await knex("coreTest.test").insert({ orgId: org.id });

    type Context = {};
    const eventEmitter = new EventEmitter();

    const core = new Core<Context>(
      knex,
      () => {
        return {};
      },
      {
        eventEmitter,
      }
    );

    core.table({
      schemaName: "coreTest",
      tableName: "test",
      tenantIdColumnName: "orgId",
    });

    const app = express();
    app.use("/sse", core.sse());
    app.use("/:orgId", core.router);
    const url = await listen(app);

    const axios = Axios.create({ baseURL: url });

    let messages: any[] = [];
    const eventSource = new EventSource(`${url}/sse`);
    eventSource.addEventListener("update", (m: any) => {
      messages.push(JSON.parse(m.data));
    });

    await axios.post(`/${org.id}/coreTest/test`, {});

    await new Promise<void>((r) => {
      let count = messages.length;
      const int = setInterval(() => {
        if (messages.length !== count) {
          clearInterval(int);
          r();
        }
      }, 100);
    });

    expect(messages).toMatchInlineSnapshot(`
      Array [
        Array [
          Object {
            "mode": "insert",
            "row": Object {
              "id": 2,
              "orgId": 1,
            },
            "schemaName": "coreTest",
            "tableName": "test",
          },
        ],
      ]
    `);

    // This should not cause an error
    eventEmitter.emit("change", [
      { mode: "insert", tableName: "a", schemaName: "b", row: {} },
    ] as ChangeSummary<any>[]);

    eventSource.close();
  });

  it("works with compression", async () => {
    const [org] = await knex("coreTest.orgs").insert({}).returning("*");
    await knex("coreTest.test").insert({ orgId: org.id });

    type Context = {};

    const core = new Core<Context>(knex, () => {
      return {};
    });

    core.table({
      schemaName: "coreTest",
      tableName: "test",
      tenantIdColumnName: "orgId",
    });

    const app = express();
    app.use(compression());
    app.use("/sse", core.sse());
    app.use("/:orgId", core.router);
    const url = await listen(app);

    const axios = Axios.create({ baseURL: url });

    let messages: any[] = [];
    const eventSource = new EventSource(`${url}/sse`);
    eventSource.addEventListener("update", (m: any) => {
      messages.push(JSON.parse(m.data));
    });

    await axios.post(`/${org.id}/coreTest/test`, {});

    await new Promise<void>((r) => {
      let count = messages.length;
      const int = setInterval(() => {
        if (messages.length !== count) {
          clearInterval(int);
          r();
        }
      }, 100);
    });

    expect(messages).toMatchInlineSnapshot(`
      Array [
        Array [
          Object {
            "mode": "insert",
            "row": Object {
              "id": 2,
              "orgId": 1,
            },
            "schemaName": "coreTest",
            "tableName": "test",
          },
        ],
      ]
    `);

    eventSource.close();
  });

  it("respects policy", async () => {
    const [org1] = await knex("coreTest.orgs").insert({}).returning("*");
    const [org2] = await knex("coreTest.orgs").insert({}).returning("*");

    type Context = { orgId: number };

    const core = new Core<Context>(knex, (req) => {
      return {
        orgId: Number(req.params.orgId),
      };
    });

    core.table({
      schemaName: "coreTest",
      tableName: "test",
      tenantIdColumnName: "orgId",
    });

    const app = express();
    app.use(compression());
    app.use(
      "/:orgId/sse",
      core.sse(async (isVisible, event, context) => {
        if (event.row.orgId === context.orgId) return await isVisible();
        return false;
      })
    );

    app.use("/:orgId", core.router);
    const url = await listen(app);

    const axios = Axios.create({ baseURL: url });

    let messages: any[] = [];
    const eventSource = new EventSource(`${url}/${org1.id}/sse`);
    eventSource.addEventListener("update", (m: any) => {
      messages.push(JSON.parse(m.data));
    });

    const count = messages.length;
    await axios.post(`/${org1.id}/coreTest/test`, {});
    await axios.post(`/${org2.id}/coreTest/test`, {});

    await new Promise<void>((r) => {
      const int = setInterval(() => {
        if (messages.length !== count) {
          clearInterval(int);
          r();
        }
      }, 100);
    });

    expect(messages).toMatchInlineSnapshot(`
      Array [
        Array [
          Object {
            "mode": "insert",
            "row": Object {
              "id": 1,
              "orgId": 1,
            },
            "schemaName": "coreTest",
            "tableName": "test",
          },
        ],
      ]
    `);

    eventSource.close();
  });

  it("works without a tenant id", async () => {
    const [org] = await knex("coreTest.orgs").insert({}).returning("*");

    type Context = {};

    const core = new Core<Context>(knex, () => {
      return {};
    });

    core.table({
      schemaName: "coreTest",
      tableName: "test",
    });

    const app = express();
    app.use(compression());
    app.use("/sse", core.sse());

    app.use(core.router);
    const url = await listen(app);

    const axios = Axios.create({ baseURL: url });

    let messages: any[] = [];
    const eventSource = new EventSource(`${url}/sse`);
    eventSource.addEventListener("update", (m: any) => {
      messages.push(JSON.parse(m.data));
    });

    const count = messages.length;
    await axios.post(`/coreTest/test?orgId=${org.id}`, {});

    await new Promise<void>((r) => {
      const int = setInterval(() => {
        if (messages.length !== count) {
          clearInterval(int);
          r();
        }
      }, 100);
    });

    expect(messages).toMatchInlineSnapshot(`
      Array [
        Array [
          Object {
            "mode": "insert",
            "row": Object {
              "id": 1,
              "orgId": 1,
            },
            "schemaName": "coreTest",
            "tableName": "test",
          },
        ],
      ]
    `);

    eventSource.close();
  });
});

describe("handles advanced queries", () => {
  beforeEach(async () => {
    await knex.schema.withSchema("core_test").createTable("test", (t) => {
      t.bigIncrements("id").primary();
      t.boolean("is_boolean").notNullable().defaultTo(false);
      t.integer("number_count").notNullable().defaultTo(0);
      t.text("text").notNullable().defaultTo("text");
    });
  });

  it("works with filters like < and >", async () => {
    await knex("coreTest.test").insert({
      isBoolean: true,
      numberCount: 10,
    });
    await knex("coreTest.test").insert({
      isBoolean: false,
      numberCount: 5,
      text: "quick brown fox",
    });
    await knex("coreTest.test").insert({
      isBoolean: false,
      numberCount: 2,
    });

    type Context = {};

    const core = new Core<Context>(knex, () => {
      return {};
    });

    core.table({
      schemaName: "coreTest",
      tableName: "test",
    });

    const app = express();
    app.use(core.router);
    await core.init();
    const url = await listen(app);

    const axios = Axios.create({ baseURL: url });

    queries = [];
    expect(
      (
        await axios
          .get(`/coreTest/test?numberCount.lte=5`)
          .catch((e) => e.response)
      ).data
    ).toMatchInlineSnapshot(`
      Object {
        "_links": Object {
          "collection": Object {
            "href": "/coreTest/test",
          },
          "count": Object {
            "href": "/coreTest/test/count?numberCount.lte=5",
          },
          "ids": Object {
            "href": "/coreTest/test/ids?numberCount.lte=5",
          },
          "self": Object {
            "href": "/coreTest/test?numberCount.lte=5",
          },
        },
        "hasMore": false,
        "items": Array [
          Object {
            "_links": Object {
              "collection": Object {
                "href": "/coreTest/test",
              },
              "self": Object {
                "href": "/coreTest/test/2",
              },
            },
            "id": 2,
            "isBoolean": false,
            "numberCount": 5,
            "text": "quick brown fox",
          },
          Object {
            "_links": Object {
              "collection": Object {
                "href": "/coreTest/test",
              },
              "self": Object {
                "href": "/coreTest/test/3",
              },
            },
            "id": 3,
            "isBoolean": false,
            "numberCount": 2,
            "text": "text",
          },
        ],
        "limit": 50,
        "page": 0,
      }
    `);
    expect(queries).toMatchInlineSnapshot(`
      Array [
        "select test.id, test.is_boolean, test.number_count, test.text from core_test.test where (test.number_count <= ?) order by test.id asc limit ?",
      ]
    `);

    queries = [];
    expect(
      (
        await axios
          .get(`/coreTest/test?numberCount.lt=5`)
          .catch((e) => e.response)
      ).data
    ).toMatchInlineSnapshot(`
      Object {
        "_links": Object {
          "collection": Object {
            "href": "/coreTest/test",
          },
          "count": Object {
            "href": "/coreTest/test/count?numberCount.lt=5",
          },
          "ids": Object {
            "href": "/coreTest/test/ids?numberCount.lt=5",
          },
          "self": Object {
            "href": "/coreTest/test?numberCount.lt=5",
          },
        },
        "hasMore": false,
        "items": Array [
          Object {
            "_links": Object {
              "collection": Object {
                "href": "/coreTest/test",
              },
              "self": Object {
                "href": "/coreTest/test/3",
              },
            },
            "id": 3,
            "isBoolean": false,
            "numberCount": 2,
            "text": "text",
          },
        ],
        "limit": 50,
        "page": 0,
      }
    `);
    expect(queries).toMatchInlineSnapshot(`
      Array [
        "select test.id, test.is_boolean, test.number_count, test.text from core_test.test where (test.number_count < ?) order by test.id asc limit ?",
      ]
    `);

    queries = [];
    expect(
      (
        await axios
          .get(`/coreTest/test?numberCount.gte=5`)
          .catch((e) => e.response)
      ).data
    ).toMatchInlineSnapshot(`
      Object {
        "_links": Object {
          "collection": Object {
            "href": "/coreTest/test",
          },
          "count": Object {
            "href": "/coreTest/test/count?numberCount.gte=5",
          },
          "ids": Object {
            "href": "/coreTest/test/ids?numberCount.gte=5",
          },
          "self": Object {
            "href": "/coreTest/test?numberCount.gte=5",
          },
        },
        "hasMore": false,
        "items": Array [
          Object {
            "_links": Object {
              "collection": Object {
                "href": "/coreTest/test",
              },
              "self": Object {
                "href": "/coreTest/test/1",
              },
            },
            "id": 1,
            "isBoolean": true,
            "numberCount": 10,
            "text": "text",
          },
          Object {
            "_links": Object {
              "collection": Object {
                "href": "/coreTest/test",
              },
              "self": Object {
                "href": "/coreTest/test/2",
              },
            },
            "id": 2,
            "isBoolean": false,
            "numberCount": 5,
            "text": "quick brown fox",
          },
        ],
        "limit": 50,
        "page": 0,
      }
    `);
    expect(queries).toMatchInlineSnapshot(`
      Array [
        "select test.id, test.is_boolean, test.number_count, test.text from core_test.test where (test.number_count >= ?) order by test.id asc limit ?",
      ]
    `);

    queries = [];
    expect(
      (
        await axios
          .get(`/coreTest/test?numberCount.gt=5`)
          .catch((e) => e.response)
      ).data
    ).toMatchInlineSnapshot(`
      Object {
        "_links": Object {
          "collection": Object {
            "href": "/coreTest/test",
          },
          "count": Object {
            "href": "/coreTest/test/count?numberCount.gt=5",
          },
          "ids": Object {
            "href": "/coreTest/test/ids?numberCount.gt=5",
          },
          "self": Object {
            "href": "/coreTest/test?numberCount.gt=5",
          },
        },
        "hasMore": false,
        "items": Array [
          Object {
            "_links": Object {
              "collection": Object {
                "href": "/coreTest/test",
              },
              "self": Object {
                "href": "/coreTest/test/1",
              },
            },
            "id": 1,
            "isBoolean": true,
            "numberCount": 10,
            "text": "text",
          },
        ],
        "limit": 50,
        "page": 0,
      }
    `);
    expect(queries).toMatchInlineSnapshot(`
      Array [
        "select test.id, test.is_boolean, test.number_count, test.text from core_test.test where (test.number_count > ?) order by test.id asc limit ?",
      ]
    `);

    queries = [];
    expect(
      (
        await axios
          .get(`/coreTest/test?numberCount.neq=5`)
          .catch((e) => e.response)
      ).data
    ).toMatchInlineSnapshot(`
      Object {
        "_links": Object {
          "collection": Object {
            "href": "/coreTest/test",
          },
          "count": Object {
            "href": "/coreTest/test/count?numberCount.neq=5",
          },
          "ids": Object {
            "href": "/coreTest/test/ids?numberCount.neq=5",
          },
          "self": Object {
            "href": "/coreTest/test?numberCount.neq=5",
          },
        },
        "hasMore": false,
        "items": Array [
          Object {
            "_links": Object {
              "collection": Object {
                "href": "/coreTest/test",
              },
              "self": Object {
                "href": "/coreTest/test/1",
              },
            },
            "id": 1,
            "isBoolean": true,
            "numberCount": 10,
            "text": "text",
          },
          Object {
            "_links": Object {
              "collection": Object {
                "href": "/coreTest/test",
              },
              "self": Object {
                "href": "/coreTest/test/3",
              },
            },
            "id": 3,
            "isBoolean": false,
            "numberCount": 2,
            "text": "text",
          },
        ],
        "limit": 50,
        "page": 0,
      }
    `);
    expect(queries).toMatchInlineSnapshot(`
      Array [
        "select test.id, test.is_boolean, test.number_count, test.text from core_test.test where (test.number_count <> ?) order by test.id asc limit ?",
      ]
    `);

    queries = [];
    expect(
      (
        await axios
          .get(`/coreTest/test?numberCount.not.eq=5`)
          .catch((e) => e.response)
      ).data
    ).toMatchInlineSnapshot(`
      Object {
        "_links": Object {
          "collection": Object {
            "href": "/coreTest/test",
          },
          "count": Object {
            "href": "/coreTest/test/count?numberCount.not.eq=5",
          },
          "ids": Object {
            "href": "/coreTest/test/ids?numberCount.not.eq=5",
          },
          "self": Object {
            "href": "/coreTest/test?numberCount.not.eq=5",
          },
        },
        "hasMore": false,
        "items": Array [
          Object {
            "_links": Object {
              "collection": Object {
                "href": "/coreTest/test",
              },
              "self": Object {
                "href": "/coreTest/test/1",
              },
            },
            "id": 1,
            "isBoolean": true,
            "numberCount": 10,
            "text": "text",
          },
          Object {
            "_links": Object {
              "collection": Object {
                "href": "/coreTest/test",
              },
              "self": Object {
                "href": "/coreTest/test/3",
              },
            },
            "id": 3,
            "isBoolean": false,
            "numberCount": 2,
            "text": "text",
          },
        ],
        "limit": 50,
        "page": 0,
      }
    `);
    expect(queries).toMatchInlineSnapshot(`
      Array [
        "select test.id, test.is_boolean, test.number_count, test.text from core_test.test where (not test.number_count = ?) order by test.id asc limit ?",
      ]
    `);

    queries = [];
    expect(
      (
        await axios
          .get(`/coreTest/test?text.ilike=%Brown%`)
          .catch((e) => e.response)
      ).data
    ).toMatchInlineSnapshot(`
      Object {
        "_links": Object {
          "collection": Object {
            "href": "/coreTest/test",
          },
          "count": Object {
            "href": "/coreTest/test/count?text.ilike=%25Brown%25",
          },
          "ids": Object {
            "href": "/coreTest/test/ids?text.ilike=%25Brown%25",
          },
          "self": Object {
            "href": "/coreTest/test?text.ilike=%25Brown%25",
          },
        },
        "hasMore": false,
        "items": Array [
          Object {
            "_links": Object {
              "collection": Object {
                "href": "/coreTest/test",
              },
              "self": Object {
                "href": "/coreTest/test/2",
              },
            },
            "id": 2,
            "isBoolean": false,
            "numberCount": 5,
            "text": "quick brown fox",
          },
        ],
        "limit": 50,
        "page": 0,
      }
    `);
    expect(queries).toMatchInlineSnapshot(`
      Array [
        "select test.id, test.is_boolean, test.number_count, test.text from core_test.test where (test.text ilike ?) order by test.id asc limit ?",
      ]
    `);
  });

  it("handles 'or's and 'and's", async () => {
    await knex("coreTest.test").insert({
      isBoolean: true,
      numberCount: 10,
    });
    await knex("coreTest.test").insert({
      isBoolean: false,
      numberCount: 5,
      text: "quick brown fox",
    });
    await knex("coreTest.test").insert({
      isBoolean: false,
      numberCount: 2,
    });

    type Context = {};

    const core = new Core<Context>(knex, () => {
      return {};
    });

    core.table({
      schemaName: "coreTest",
      tableName: "test",
    });

    const app = express();
    app.use(core.router);
    await core.init();
    const url = await listen(app);

    const axios = Axios.create({ baseURL: url });

    queries = [];
    await axios.get(
      `/coreTest/test?text.like=%brown%&or[numberCount]=10&or[numberCount.lt]=3`
    );
    expect(queries).toMatchInlineSnapshot(`
      Array [
        "select test.id, test.is_boolean, test.number_count, test.text from core_test.test where (test.text like ? or (test.number_count = ? and test.number_count < ?)) order by test.id asc limit ?",
      ]
    `);

    queries = [];
    await axios.get(`/coreTest/test?id[]=1&or[id][]=2&and[id.not][]=3`);
    expect(queries).toMatchInlineSnapshot(`
      Array [
        "select test.id, test.is_boolean, test.number_count, test.text from core_test.test where (test.id in (?) or (test.id in (?)) and (test.id not in (?))) order by test.id asc limit ?",
      ]
    `);
  });
});

describe("validates without write", () => {
  beforeEach(async () => {
    await knex.schema.withSchema("core_test").createTable("test", (t) => {
      t.bigIncrements("id").primary();
      t.boolean("is_boolean").notNullable().defaultTo(false);
      t.integer("number_count").notNullable().defaultTo(0);
      t.text("text").notNullable().defaultTo("text");
    });
  });

  it("validates existing", async () => {
    const [row] = await knex("coreTest.test")
      .insert({
        isBoolean: true,
        numberCount: 10,
      })
      .returning("*");

    type Context = {};

    const core = new Core<Context>(knex, () => {
      return {};
    });

    core.table({
      schemaName: "coreTest",
      tableName: "test",
    });

    const app = express();
    app.use(core.router);
    await core.init();
    const url = await listen(app);

    const axios = Axios.create({ baseURL: url });

    queries = [];
    expect(
      (
        await axios.put(`/coreTest/test/${row.id}/validate`, {
          numberCount: "abc",
        })
      ).data
    ).toMatchInlineSnapshot(`
      Object {
        "errors": Object {
          "numberCount": "must be a \`number\` type, but the final value was: \`NaN\` (cast from the value \`\\"abc\\"\`).",
        },
      }
    `);
    expect(queries).toMatchInlineSnapshot(`
      Array [
        "select test.id, test.is_boolean, test.number_count, test.text from core_test.test where (test.id = ?) limit ?",
      ]
    `);

    queries = [];
    expect(
      (
        await axios.put(`/coreTest/test/${row.id}/validate`, {
          numberCount: "123",
        })
      ).data
    ).toMatchInlineSnapshot(`
      Object {
        "errors": Object {},
      }
    `);
    expect(queries).toMatchInlineSnapshot(`
      Array [
        "select test.id, test.is_boolean, test.number_count, test.text from core_test.test where (test.id = ?) limit ?",
      ]
    `);
  });

  it("validates on create", async () => {
    type Context = {};

    const core = new Core<Context>(knex, () => {
      return {};
    });

    core.table({
      schemaName: "coreTest",
      tableName: "test",
    });

    const app = express();
    app.use(core.router);
    await core.init();
    const url = await listen(app);

    const axios = Axios.create({ baseURL: url });

    queries = [];
    expect(
      (
        await axios.post(`/coreTest/test/validate`, {
          numberCount: "abc",
        })
      ).data
    ).toMatchInlineSnapshot(`
      Object {
        "errors": Object {
          "numberCount": "must be a \`number\` type, but the final value was: \`NaN\` (cast from the value \`\\"abc\\"\`).",
        },
      }
    `);
    expect(queries).toMatchInlineSnapshot(`Array []`);

    queries = [];
    expect(
      (
        await axios.post(`/coreTest/test/validate`, {
          numberCount: "123",
        })
      ).data
    ).toMatchInlineSnapshot(`
      Object {
        "errors": Object {},
      }
    `);
    expect(queries).toMatchInlineSnapshot(`Array []`);
  });
});

describe("creates a router", () => {
  it("router is same reference", async () => {
    const core = new Core(knex, () => {
      return {};
    });

    expect(core.router).toEqual(core.router);
  });
});
