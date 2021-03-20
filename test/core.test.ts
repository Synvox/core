import Knex from "knex";
import { createServer } from "http";
import testListen from "test-listen";
import express, { Application } from "express";
import Axios from "axios";
import { knexHelpers, Core, StatusError } from "../src";

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
      () => ({}),
      async () => knex
    );

    core.table({
      schemaName: "coreTest",
      tableName: "test",
    });

    const app = express();
    app.use(core.router());
    const url = await listen(app);

    const axios = Axios.create({ baseURL: url });

    expect((await axios.get("/coreTest/test").catch((e) => e.response)).data)
      .toMatchInlineSnapshot(`
      Object {
        "data": Array [
          Object {
            "_links": Object {},
            "_type": "coreTest/test",
            "_url": "/coreTest/test/1",
            "id": 1,
            "isBoolean": false,
            "numberCount": 0,
            "text": "text",
          },
        ],
        "meta": Object {
          "_links": Object {
            "count": "/coreTest/test/count",
            "ids": "/coreTest/test/ids",
          },
          "_type": "coreTest/test",
          "_url": "/coreTest/test",
          "hasMore": false,
          "limit": 50,
          "page": 0,
        },
      }
    `);
  });

  it("reads by id", async () => {
    const [row] = await knex("coreTest.test").insert({}).returning("*");

    const core = new Core(
      () => ({}),
      async () => knex
    );

    core.table({
      schemaName: "coreTest",
      tableName: "test",
    });

    const app = express();
    app.use(core.router());
    const url = await listen(app);

    const axios = Axios.create({ baseURL: url });

    expect(
      (await axios.get(`/coreTest/test/${row.id}`).catch((e) => e.response))
        .data
    ).toMatchInlineSnapshot(`
      Object {
        "data": Object {
          "_links": Object {},
          "_type": "coreTest/test",
          "_url": "/coreTest/test/1",
          "id": 1,
          "isBoolean": false,
          "numberCount": 0,
          "text": "text",
        },
      }
    `);
  });

  it("inserts", async () => {
    const core = new Core(
      () => ({}),
      async () => knex
    );

    core.table({
      schemaName: "coreTest",
      tableName: "test",
    });

    const app = express();
    app.use(core.router());
    const url = await listen(app);

    const axios = Axios.create({ baseURL: url });

    expect(
      (await axios.post("/coreTest/test", {}).catch((e) => e.response)).data
    ).toMatchInlineSnapshot(`
      Object {
        "changes": Array [
          Object {
            "mode": "insert",
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
        "data": Object {
          "_links": Object {},
          "_type": "coreTest/test",
          "_url": "/coreTest/test/1",
          "id": 1,
          "isBoolean": false,
          "numberCount": 0,
          "text": "text",
        },
      }
    `);
  });

  it("updates", async () => {
    const [row] = await knex("coreTest.test").insert({}).returning("*");

    const core = new Core(
      () => ({}),
      async () => knex
    );

    core.table({
      schemaName: "coreTest",
      tableName: "test",
    });

    const app = express();
    app.use(core.router());
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
          "_links": Object {},
          "_type": "coreTest/test",
          "_url": "/coreTest/test/1",
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

    const core = new Core(
      () => ({}),
      async () => knex
    );

    core.table({
      schemaName: "coreTest",
      tableName: "test",
    });

    const app = express();
    app.use(core.router());
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
          "numberCount": "must be a \`number\` type, but the final value was: \`\\"not a number\\"\`.",
        },
      }
    `);
  });

  it("closes connection on unknown error", async () => {
    const [row] = await knex("coreTest.test").insert({}).returning("*");

    const core = new Core(
      () => ({}),
      async () => knex
    );

    core.table({
      schemaName: "coreTest",
      tableName: "test",
      afterUpdate() {
        throw new Error("err");
      },
    });

    const app = express();
    app.use(core.router());
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

    const core = new Core(
      () => ({}),
      async () => knex
    );

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
    app.use(core.router());
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

    const core = new Core(
      () => ({}),
      async () => knex
    );

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
    app.use(core.router());
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

    const core = new Core(
      () => ({}),
      async () => knex
    );

    core.table({
      schemaName: "coreTest",
      tableName: "test",
    });

    const app = express();
    app.use(core.router());
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

    const core = new Core(
      () => ({}),
      async () => knex
    );

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
    app.use(core.router());
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

    const core = new Core(
      () => ({}),
      async () => knex
    );

    core.table({
      schemaName: "coreTest",
      tableName: "test",
    });

    const app = express();
    app.use(core.router());
    const url = await listen(app);

    const axios = Axios.create({ baseURL: url });

    expect(
      (await axios.get(`/coreTest/test/ids`).catch((e) => e.response)).data
    ).toMatchInlineSnapshot(`
      Object {
        "data": Array [
          1,
        ],
        "meta": Object {
          "_links": Object {},
          "_url": "/coreTest/test/ids",
          "hasMore": false,
          "limit": 1000,
          "page": 0,
        },
      }
    `);
  });

  it("gets count", async () => {
    await knex("coreTest.test").insert({}).returning("*");

    const core = new Core(
      () => ({}),
      async () => knex
    );

    core.table({
      schemaName: "coreTest",
      tableName: "test",
    });

    const app = express();
    app.use(core.router());
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

    const core = new Core(
      () => ({}),
      async () => knex
    );

    core.table({
      schemaName: "coreTest",
      tableName: "test",
    });

    const app = express();
    app.use(core.router());

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
