import Knex from "knex";
import { knexHelpers, Table, withTimestamps } from "../src";
import uuid from "uuid";
import withQuery from "../src/plugins/withQuery";

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

  const anonymousId = "uuid-test-value";
  jest.spyOn(uuid, "v4").mockReturnValue(anonymousId);
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

    queries = [];
    await users.write(
      knex,
      {
        posts: [{}, {}],
      },
      {}
    );
    expect(queries).toMatchInlineSnapshot(`
      Array [
        "insert into test_plugins.users default values returning *",
        "insert into test_plugins.posts (user_id) values (?) returning *",
        "insert into test_plugins.posts (user_id) values (?) returning *",
        "select users__base_table.id, users__base_table.updated_at, users__base_table.created_at from test_plugins.users users__base_table where users__base_table.id = ? limit ?",
        "select posts.id, posts.user_id, posts.body, posts.updated_at, posts.created_at from test_plugins.posts where posts.id = ? limit ?",
        "select posts.id, posts.user_id, posts.body, posts.updated_at, posts.created_at from test_plugins.posts where posts.id = ? limit ?",
      ]
    `);

    queries = [];
    await users.write(
      knex,
      {
        id: 1,
      },
      {}
    );
    expect(queries).toMatchInlineSnapshot(`
      Array [
        "select users.id, users.updated_at, users.created_at from test_plugins.users where (users.id = ?) limit ?",
        "select users__base_table.id, users__base_table.updated_at, users__base_table.created_at from test_plugins.users users__base_table where users__base_table.id = ? limit ?",
        "update test_plugins.users users__base_table set updated_at = ?, created_at = ? where users__base_table.id = ? returning *",
        "update test_plugins.users set updated_at = now() where id = ?",
        "select users__base_table.id, users__base_table.updated_at, users__base_table.created_at from test_plugins.users users__base_table where users__base_table.id = ? limit ?",
      ]
    `);

    queries = [];
    await posts.write(
      knex,
      {
        id: 1,
        _delete: true,
      },
      {}
    );
    expect(queries).toMatchInlineSnapshot(`
      Array [
        "select posts__base_table.id, posts__base_table.user_id, posts__base_table.body, posts__base_table.updated_at, posts__base_table.created_at from test_plugins.posts posts__base_table where posts__base_table.id = ? limit ?",
        "delete from test_plugins.posts posts__base_table where posts__base_table.id = ?",
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
    await items.write(knex, {}, { context: "value" });
    expect(queries).toMatchInlineSnapshot(`
      Array [
        "insert into test_plugins.items default values returning *",
        "select items__base_table.id, items__base_table.updated_at, items__base_table.created_at from test_plugins.items items__base_table where items__base_table.id = ? limit ?",
      ]
    `);
    expect(result).toMatchInlineSnapshot(`
      Array [
        Array [
          Object {
            "context": "value",
          },
          "insert",
          Object {},
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
        "_links": Object {
          "count": "/testPlugins/items/count?since=1999-01-01%2004%3A05%3A06",
          "ids": "/testPlugins/items/ids?since=1999-01-01%2004%3A05%3A06",
        },
        "_type": "testPlugins/items",
        "_url": "/testPlugins/items?since=1999-01-01%2004%3A05%3A06",
        "hasMore": false,
        "items": Array [
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
        "limit": 50,
        "page": 0,
      }
    `);
    expect(queries).toMatchInlineSnapshot(`
      Array [
        "select items__base_table.id, items__base_table.updated_at, items__base_table.created_at from test_plugins.items items__base_table where items__base_table.updated_at > ? order by items__base_table.id asc limit ?",
      ]
    `);

    queries = [];
    expect(await items.readMany(knex, { since: "1999-01-10 04:05:06" }, {}))
      .toMatchInlineSnapshot(`
      Object {
        "_links": Object {
          "count": "/testPlugins/items/count?since=1999-01-10%2004%3A05%3A06",
          "ids": "/testPlugins/items/ids?since=1999-01-10%2004%3A05%3A06",
        },
        "_type": "testPlugins/items",
        "_url": "/testPlugins/items?since=1999-01-10%2004%3A05%3A06",
        "hasMore": false,
        "items": Array [
          Object {
            "_links": Object {},
            "_type": "testPlugins/items",
            "_url": "/testPlugins/items/2",
            "createdAt": 1999-01-08T10:05:06.000Z,
            "id": 2,
            "updatedAt": 1999-01-12T10:05:06.000Z,
          },
        ],
        "limit": 50,
        "page": 0,
      }
    `);
    expect(queries).toMatchInlineSnapshot(`
      Array [
        "select items__base_table.id, items__base_table.updated_at, items__base_table.created_at from test_plugins.items items__base_table where items__base_table.updated_at > ? order by items__base_table.id asc limit ?",
      ]
    `);

    queries = [];
    expect(await items.readMany(knex, { since: "something bogus" }, {}))
      .toMatchInlineSnapshot(`
      Object {
        "_links": Object {
          "count": "/testPlugins/items/count?since=something%20bogus",
          "ids": "/testPlugins/items/ids?since=something%20bogus",
        },
        "_type": "testPlugins/items",
        "_url": "/testPlugins/items?since=something%20bogus",
        "hasMore": false,
        "items": Array [
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
        "limit": 50,
        "page": 0,
      }
    `);
    expect(queries).toMatchInlineSnapshot(`
      Array [
        "select items__base_table.id, items__base_table.updated_at, items__base_table.created_at from test_plugins.items items__base_table order by items__base_table.id asc limit ?",
      ]
    `);
  });
});

describe("withQuery plugin", () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it("allows search on multiple columns", async () => {
    await knex.schema.withSchema("test_plugins").createTable("users", (t) => {
      t.bigIncrements("id").primary();
      t.text("first_name");
      t.text("last_name");
      t.text("email");
    });

    await knex("test_plugins.users").insert([
      {
        firstName: "Billy",
        lastName: "Bob",
        email: "billy@bobjones.com",
      },
      {
        firstName: "John",
        lastName: "Doe",
        email: "johndoe@domain.com",
      },
    ]);

    const users = new Table(
      withQuery(["firstName", "lastName", "email"], {
        schemaName: "testPlugins",
        tableName: "users",
      })
    );

    queries = [];
    expect(await users.readMany(knex, { query: "Billy" }, {}))
      .toMatchInlineSnapshot(`
      Object {
        "_links": Object {
          "count": "/testPlugins/users/count?query=Billy",
          "ids": "/testPlugins/users/ids?query=Billy",
        },
        "_type": "testPlugins/users",
        "_url": "/testPlugins/users?query=Billy",
        "hasMore": false,
        "items": Array [
          Object {
            "_links": Object {},
            "_type": "testPlugins/users",
            "_url": "/testPlugins/users/1",
            "email": "billy@bobjones.com",
            "firstName": "Billy",
            "id": 1,
            "lastName": "Bob",
          },
        ],
        "limit": 50,
        "page": 0,
      }
    `);
    expect(queries).toMatchInlineSnapshot(`
      Array [
        "select * from test_plugins.users users__base_table where to_tsvector(users__base_table.first_name) || to_tsvector(users__base_table.last_name) || to_tsvector(users__base_table.email) @@ to_tsquery('simple', ? || ':*') order by users__base_table.id asc limit ?",
      ]
    `);

    queries = [];
    expect(await users.readMany(knex, { query: "Billy Bob" }, {}))
      .toMatchInlineSnapshot(`
      Object {
        "_links": Object {
          "count": "/testPlugins/users/count?query=Billy%20Bob",
          "ids": "/testPlugins/users/ids?query=Billy%20Bob",
        },
        "_type": "testPlugins/users",
        "_url": "/testPlugins/users?query=Billy%20Bob",
        "hasMore": false,
        "items": Array [
          Object {
            "_links": Object {},
            "_type": "testPlugins/users",
            "_url": "/testPlugins/users/1",
            "email": "billy@bobjones.com",
            "firstName": "Billy",
            "id": 1,
            "lastName": "Bob",
          },
        ],
        "limit": 50,
        "page": 0,
      }
    `);
    expect(queries).toMatchInlineSnapshot(`
      Array [
        "select * from test_plugins.users users__base_table where to_tsvector(users__base_table.first_name) || to_tsvector(users__base_table.last_name) || to_tsvector(users__base_table.email) @@ to_tsquery('simple', ? || ':*' || ' & ' || ? || ':*') order by users__base_table.id asc limit ?",
      ]
    `);

    queries = [];
    expect(await users.readMany(knex, { query: "Billy " }, {}))
      .toMatchInlineSnapshot(`
      Object {
        "_links": Object {
          "count": "/testPlugins/users/count?query=Billy%20",
          "ids": "/testPlugins/users/ids?query=Billy%20",
        },
        "_type": "testPlugins/users",
        "_url": "/testPlugins/users?query=Billy%20",
        "hasMore": false,
        "items": Array [
          Object {
            "_links": Object {},
            "_type": "testPlugins/users",
            "_url": "/testPlugins/users/1",
            "email": "billy@bobjones.com",
            "firstName": "Billy",
            "id": 1,
            "lastName": "Bob",
          },
        ],
        "limit": 50,
        "page": 0,
      }
    `);
    expect(queries).toMatchInlineSnapshot(`
      Array [
        "select * from test_plugins.users users__base_table where to_tsvector(users__base_table.first_name) || to_tsvector(users__base_table.last_name) || to_tsvector(users__base_table.email) @@ to_tsquery('simple', ? || ':*') order by users__base_table.id asc limit ?",
      ]
    `);

    queries = [];
    expect(await users.readMany(knex, { query: "jo" }, {}))
      .toMatchInlineSnapshot(`
      Object {
        "_links": Object {
          "count": "/testPlugins/users/count?query=jo",
          "ids": "/testPlugins/users/ids?query=jo",
        },
        "_type": "testPlugins/users",
        "_url": "/testPlugins/users?query=jo",
        "hasMore": false,
        "items": Array [
          Object {
            "_links": Object {},
            "_type": "testPlugins/users",
            "_url": "/testPlugins/users/2",
            "email": "johndoe@domain.com",
            "firstName": "John",
            "id": 2,
            "lastName": "Doe",
          },
        ],
        "limit": 50,
        "page": 0,
      }
    `);
    expect(queries).toMatchInlineSnapshot(`
      Array [
        "select * from test_plugins.users users__base_table where to_tsvector(users__base_table.first_name) || to_tsvector(users__base_table.last_name) || to_tsvector(users__base_table.email) @@ to_tsquery('simple', ? || ':*') order by users__base_table.id asc limit ?",
      ]
    `);

    queries = [];
    expect(await users.readMany(knex, { query: "johndoe@domain.com" }, {}))
      .toMatchInlineSnapshot(`
      Object {
        "_links": Object {
          "count": "/testPlugins/users/count?query=johndoe%40domain.com",
          "ids": "/testPlugins/users/ids?query=johndoe%40domain.com",
        },
        "_type": "testPlugins/users",
        "_url": "/testPlugins/users?query=johndoe%40domain.com",
        "hasMore": false,
        "items": Array [
          Object {
            "_links": Object {},
            "_type": "testPlugins/users",
            "_url": "/testPlugins/users/2",
            "email": "johndoe@domain.com",
            "firstName": "John",
            "id": 2,
            "lastName": "Doe",
          },
        ],
        "limit": 50,
        "page": 0,
      }
    `);
    expect(queries).toMatchInlineSnapshot(`
      Array [
        "select * from test_plugins.users users__base_table where to_tsvector(users__base_table.first_name) || to_tsvector(users__base_table.last_name) || to_tsvector(users__base_table.email) @@ to_tsquery('simple', ? || ':*') order by users__base_table.id asc limit ?",
      ]
    `);
  });
});
