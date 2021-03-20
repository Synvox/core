import Knex from "knex";
import { knexHelpers } from "../src";
import { Table } from "../src/Table";
import withTimestamps from "../src/plugins/withTimestamps";

let queries: string[] = [];

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
    drop schema if exists test_plugins cascade;
    create schema test_plugins;
  `);
});

afterEach(() => {
  queries = [];
});

afterAll(async () => {
  await knex.destroy();
});

describe("withTimestamps plugin", () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it("updates timestamps on write", async () => {
    await knex.schema.withSchema("test_plugins").createTable("users", (t) => {
      t.bigIncrements("id").primary();
      t.timestamp("updated_at").defaultTo("1999-01-08 04:05:06").notNullable();
      t.timestamp("created_at").defaultTo("1999-01-08 04:05:06").notNullable();
    });

    await knex.schema.withSchema("test_plugins").createTable("posts", (t) => {
      t.bigIncrements("id").primary();
      t.bigInteger("user_id")
        .references("id")
        .inTable("test_plugins.users")
        .notNullable();
      t.text("body").notNullable().defaultTo("");
      t.timestamp("updated_at").defaultTo("1999-01-08 04:05:06").notNullable();
      t.timestamp("created_at").defaultTo("1999-01-08 04:05:06").notNullable();
    });

    const users = new Table(
      withTimestamps({
        schemaName: "testPlugins",
        tableName: "users",
      })
    );

    const posts = new Table(
      withTimestamps({
        schemaName: "testPlugins",
        tableName: "posts",
      })
    );

    await users.init(knex);
    await posts.init(knex);
    users.linkTables([users, posts]);
    posts.linkTables([users, posts]);

    jest
      .spyOn(global.Date, "now")
      .mockImplementation(() => Date.parse("2021-01-01T01:01:00.000Z"));

    queries = [];
    expect(
      await users.write(
        knex,
        {
          posts: [{}, {}],
        },
        {}
      )
    ).toMatchInlineSnapshot(`
      Object {
        "changes": Array [
          Object {
            "mode": "insert",
            "row": Object {
              "createdAt": 2021-01-01T01:01:00.000Z,
              "id": 1,
              "updatedAt": 2021-01-01T01:01:00.000Z,
            },
            "schemaName": "testPlugins",
            "tableName": "users",
          },
          Object {
            "mode": "insert",
            "row": Object {
              "body": "",
              "createdAt": 2021-01-01T01:01:00.000Z,
              "id": 1,
              "updatedAt": 2021-01-01T01:01:00.000Z,
              "userId": 1,
            },
            "schemaName": "testPlugins",
            "tableName": "posts",
          },
          Object {
            "mode": "insert",
            "row": Object {
              "body": "",
              "createdAt": 2021-01-01T01:01:00.000Z,
              "id": 2,
              "updatedAt": 2021-01-01T01:01:00.000Z,
              "userId": 1,
            },
            "schemaName": "testPlugins",
            "tableName": "posts",
          },
        ],
        "result": Object {
          "_links": Object {
            "posts": "/testPlugins/posts?userId=1",
          },
          "_type": "testPlugins/users",
          "_url": "/testPlugins/users/1",
          "createdAt": 2021-01-01T01:01:00.000Z,
          "id": 1,
          "posts": Array [
            Object {
              "_links": Object {
                "user": "/testPlugins/users/1",
              },
              "_type": "testPlugins/posts",
              "_url": "/testPlugins/posts/1",
              "body": "",
              "createdAt": 2021-01-01T01:01:00.000Z,
              "id": 1,
              "updatedAt": 2021-01-01T01:01:00.000Z,
              "userId": 1,
            },
            Object {
              "_links": Object {
                "user": "/testPlugins/users/1",
              },
              "_type": "testPlugins/posts",
              "_url": "/testPlugins/posts/2",
              "body": "",
              "createdAt": 2021-01-01T01:01:00.000Z,
              "id": 2,
              "updatedAt": 2021-01-01T01:01:00.000Z,
              "userId": 1,
            },
          ],
          "updatedAt": 2021-01-01T01:01:00.000Z,
        },
      }
    `);
    expect(queries).toMatchInlineSnapshot(`
      Array [
        "insert into test_plugins.users (created_at, updated_at) values (?, ?) returning *",
        "select users.id, users.updated_at, users.created_at from test_plugins.users where users.id = ? limit ?",
        "insert into test_plugins.posts (created_at, updated_at, user_id) values (?, ?, ?) returning *",
        "select posts.id, posts.user_id, posts.body, posts.updated_at, posts.created_at from test_plugins.posts where posts.id = ? limit ?",
        "insert into test_plugins.posts (created_at, updated_at, user_id) values (?, ?, ?) returning *",
        "select posts.id, posts.user_id, posts.body, posts.updated_at, posts.created_at from test_plugins.posts where posts.id = ? limit ?",
      ]
    `);

    jest
      .spyOn(global.Date, "now")
      .mockImplementation(() => Date.parse("2021-01-02T01:01:00.000Z"));

    queries = [];
    expect(
      await users.write(
        knex,
        {
          id: 1,
        },
        {}
      )
    ).toMatchInlineSnapshot(`
      Object {
        "changes": Array [
          Object {
            "mode": "update",
            "row": Object {
              "createdAt": 2021-01-01T01:01:00.000Z,
              "id": 1,
              "updatedAt": 2021-01-02T01:01:00.000Z,
            },
            "schemaName": "testPlugins",
            "tableName": "users",
          },
        ],
        "result": Object {
          "_links": Object {
            "posts": "/testPlugins/posts?userId=1",
          },
          "_type": "testPlugins/users",
          "_url": "/testPlugins/users/1",
          "createdAt": 2021-01-01T01:01:00.000Z,
          "id": 1,
          "updatedAt": 2021-01-02T01:01:00.000Z,
        },
      }
    `);
    expect(queries).toMatchInlineSnapshot(`
      Array [
        "select users.id, users.updated_at, users.created_at from test_plugins.users where users.id = ? limit ?",
        "select users.id, users.updated_at, users.created_at from test_plugins.users where users.id = ? limit ?",
        "update test_plugins.users set updated_at = ? where users.id = ?",
        "select users.id, users.updated_at, users.created_at from test_plugins.users where users.id = ? limit ?",
      ]
    `);

    queries = [];
    expect(
      await posts.write(
        knex,
        {
          id: 1,
          _delete: true,
        },
        {}
      )
    ).toMatchInlineSnapshot(`
      Object {
        "changes": Array [
          Object {
            "mode": "delete",
            "row": Object {
              "body": "",
              "createdAt": 2021-01-01T01:01:00.000Z,
              "id": 1,
              "updatedAt": 2021-01-01T01:01:00.000Z,
              "userId": 1,
            },
            "schemaName": "testPlugins",
            "tableName": "posts",
          },
        ],
        "result": null,
      }
    `);
    expect(queries).toMatchInlineSnapshot(`
      Array [
        "select posts.id, posts.user_id, posts.body, posts.updated_at, posts.created_at from test_plugins.posts where posts.id = ? limit ?",
        "delete from test_plugins.posts where posts.id = ?",
      ]
    `);
  });

  it("does not break beforeUpdate", async () => {
    await knex.schema.withSchema("test_plugins").createTable("items", (t) => {
      t.bigIncrements("id").primary();
      t.timestamp("updated_at").defaultTo("1999-01-08 04:05:06").notNullable();
      t.timestamp("created_at").defaultTo("1999-01-08 04:05:06").notNullable();
    });

    const result: any[][] = [];
    const items = new Table<any>(
      withTimestamps({
        schemaName: "testPlugins",
        tableName: "items",
        async beforeUpdate(_trx, context, mode, draft, current) {
          result.push([context, mode, draft, current]);
        },
      })
    );

    await items.init(knex);

    queries = [];
    expect(await items.write(knex, {}, { context: "value" }))
      .toMatchInlineSnapshot(`
      Object {
        "changes": Array [
          Object {
            "mode": "insert",
            "row": Object {
              "createdAt": 2021-01-02T01:01:00.000Z,
              "id": 1,
              "updatedAt": 2021-01-02T01:01:00.000Z,
            },
            "schemaName": "testPlugins",
            "tableName": "items",
          },
        ],
        "result": Object {
          "_links": Object {},
          "_type": "testPlugins/items",
          "_url": "/testPlugins/items/1",
          "createdAt": 2021-01-02T01:01:00.000Z,
          "id": 1,
          "updatedAt": 2021-01-02T01:01:00.000Z,
        },
      }
    `);
    expect(queries).toMatchInlineSnapshot(`
      Array [
        "insert into test_plugins.items (created_at, updated_at) values (?, ?) returning *",
        "select items.id, items.updated_at, items.created_at from test_plugins.items where items.id = ? limit ?",
      ]
    `);
    expect(result).toMatchInlineSnapshot(`
      Array [
        Array [
          Object {
            "context": "value",
          },
          "insert",
          Object {
            "createdAt": 2021-01-02T01:01:00.000Z,
            "updatedAt": 2021-01-02T01:01:00.000Z,
          },
          undefined,
        ],
      ]
    `);
  });

  it("provides ?since param", async () => {
    await knex.schema.withSchema("test_plugins").createTable("items", (t) => {
      t.bigIncrements("id").primary();
      t.timestamp("updated_at").defaultTo("1999-01-08 04:05:06").notNullable();
      t.timestamp("created_at").defaultTo("1999-01-08 04:05:06").notNullable();
    });

    await knex("testPlugins.items").insert({});

    await knex("testPlugins.items").insert({
      updatedAt: "1999-01-12 04:05:06",
    });

    const items = new Table<any>(
      withTimestamps({
        schemaName: "testPlugins",
        tableName: "items",
      })
    );

    await items.init(knex);

    queries = [];
    expect(await items.readMany(knex, { since: "1999-01-01 04:05:06" }, {}))
      .toMatchInlineSnapshot(`
      Object {
        "data": Array [
          Object {
            "_links": Object {},
            "_type": "testPlugins/items",
            "_url": "/testPlugins/items/1",
            "createdAt": 1999-01-08T10:05:06.000Z,
            "id": 1,
            "updatedAt": 1999-01-08T10:05:06.000Z,
          },
          Object {
            "_links": Object {},
            "_type": "testPlugins/items",
            "_url": "/testPlugins/items/2",
            "createdAt": 1999-01-08T10:05:06.000Z,
            "id": 2,
            "updatedAt": 1999-01-12T10:05:06.000Z,
          },
        ],
        "meta": Object {
          "_collection": "testPlugins/items",
          "_links": Object {
            "count": "/testPlugins/items/count?since=1999-01-01%2004%3A05%3A06",
            "ids": "/testPlugins/items/ids?since=1999-01-01%2004%3A05%3A06",
          },
          "_type": "collection",
          "_url": "/testPlugins/items?since=1999-01-01%2004%3A05%3A06",
          "hasMore": false,
          "limit": 50,
          "page": 0,
        },
      }
    `);
    expect(queries).toMatchInlineSnapshot(`
      Array [
        "select items.id, items.updated_at, items.created_at from test_plugins.items where items.updated_at > ? order by items.id asc limit ?",
      ]
    `);

    queries = [];
    expect(await items.readMany(knex, { since: "1999-01-10 04:05:06" }, {}))
      .toMatchInlineSnapshot(`
      Object {
        "data": Array [
          Object {
            "_links": Object {},
            "_type": "testPlugins/items",
            "_url": "/testPlugins/items/2",
            "createdAt": 1999-01-08T10:05:06.000Z,
            "id": 2,
            "updatedAt": 1999-01-12T10:05:06.000Z,
          },
        ],
        "meta": Object {
          "_collection": "testPlugins/items",
          "_links": Object {
            "count": "/testPlugins/items/count?since=1999-01-10%2004%3A05%3A06",
            "ids": "/testPlugins/items/ids?since=1999-01-10%2004%3A05%3A06",
          },
          "_type": "collection",
          "_url": "/testPlugins/items?since=1999-01-10%2004%3A05%3A06",
          "hasMore": false,
          "limit": 50,
          "page": 0,
        },
      }
    `);
    expect(queries).toMatchInlineSnapshot(`
      Array [
        "select items.id, items.updated_at, items.created_at from test_plugins.items where items.updated_at > ? order by items.id asc limit ?",
      ]
    `);

    queries = [];
    expect(await items.readMany(knex, { since: "something bogus" }, {}))
      .toMatchInlineSnapshot(`
      Object {
        "data": Array [
          Object {
            "_links": Object {},
            "_type": "testPlugins/items",
            "_url": "/testPlugins/items/1",
            "createdAt": 1999-01-08T10:05:06.000Z,
            "id": 1,
            "updatedAt": 1999-01-08T10:05:06.000Z,
          },
          Object {
            "_links": Object {},
            "_type": "testPlugins/items",
            "_url": "/testPlugins/items/2",
            "createdAt": 1999-01-08T10:05:06.000Z,
            "id": 2,
            "updatedAt": 1999-01-12T10:05:06.000Z,
          },
        ],
        "meta": Object {
          "_collection": "testPlugins/items",
          "_links": Object {
            "count": "/testPlugins/items/count?since=something%20bogus",
            "ids": "/testPlugins/items/ids?since=something%20bogus",
          },
          "_type": "collection",
          "_url": "/testPlugins/items?since=something%20bogus",
          "hasMore": false,
          "limit": 50,
          "page": 0,
        },
      }
    `);
    expect(queries).toMatchInlineSnapshot(`
      Array [
        "select items.id, items.updated_at, items.created_at from test_plugins.items order by items.id asc limit ?",
      ]
    `);
  });
});
