import Knex from "knex";
import {
  knexHelpers,
  Table,
  BadRequestError,
  NotFoundError,
  UnauthorizedError,
} from "../src";
import { string } from "yup";
import { Mode } from "../src/types";
import QueryString from "qs";

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
    drop schema if exists test cascade;
    create schema test;
    drop table if exists public.test_table;
  `);
});

afterEach(() => {
  queries = [];
});

afterAll(async () => {
  await knex.destroy();
});

describe("without policies", () => {
  it("reads", async () => {
    await knex.schema.withSchema("test").createTable("test", (t) => {
      t.bigIncrements("id").primary();
      t.boolean("is_boolean").notNullable().defaultTo(false);
      t.integer("number_count").notNullable().defaultTo(0);
      t.specificType("text", "character varying(10)")
        .notNullable()
        .defaultTo("text");
    });

    const table = new Table({
      schemaName: "test",
      tableName: "test",
    });

    await table.init(knex);

    for (let i = 0; i < 2; i++) await knex("test.test").insert({});

    queries = [];
    expect(await table.read(knex, {}, {})).toMatchInlineSnapshot(`
      Object {
        "data": Array [
          Object {
            "_links": Object {},
            "_type": "test/test",
            "_url": "/test/test/1",
            "id": 1,
            "isBoolean": false,
            "numberCount": 0,
            "text": "text",
          },
          Object {
            "_links": Object {},
            "_type": "test/test",
            "_url": "/test/test/2",
            "id": 2,
            "isBoolean": false,
            "numberCount": 0,
            "text": "text",
          },
        ],
        "meta": Object {
          "_collection": "test/test",
          "_links": Object {
            "count": "/test/test/count",
            "ids": "/test/test/ids",
          },
          "_type": "collection",
          "_url": "/test/test",
          "hasMore": false,
          "limit": 50,
          "page": 0,
        },
      }
    `);
    expect(queries).toMatchInlineSnapshot(`
      Array [
        "select test.id, test.is_boolean, test.number_count, test.text from test.test order by test.id asc limit ?",
      ]
    `);

    queries = [];
    expect(await table.read(knex, { id: 1 }, {}, false)).toMatchInlineSnapshot(`
      Object {
        "_links": Object {},
        "_type": "test/test",
        "_url": "/test/test/1",
        "id": 1,
        "isBoolean": false,
        "numberCount": 0,
        "text": "text",
      }
    `);
    expect(queries).toMatchInlineSnapshot(`
      Array [
        "select test.id, test.is_boolean, test.number_count, test.text from test.test where test.id = ? limit ?",
      ]
    `);

    queries = [];
    expect(await table.read(knex, { id: [1] }, {})).toMatchInlineSnapshot(`
      Object {
        "data": Array [
          Object {
            "_links": Object {},
            "_type": "test/test",
            "_url": "/test/test/1",
            "id": 1,
            "isBoolean": false,
            "numberCount": 0,
            "text": "text",
          },
        ],
        "meta": Object {
          "_collection": "test/test",
          "_links": Object {
            "count": "/test/test/count?id[]=1",
            "ids": "/test/test/ids?id[]=1",
          },
          "_type": "collection",
          "_url": "/test/test?id[]=1",
          "hasMore": false,
          "limit": 50,
          "page": 0,
        },
      }
    `);
    expect(queries).toMatchInlineSnapshot(`
      Array [
        "select test.id, test.is_boolean, test.number_count, test.text from test.test where test.id in (?) order by test.id asc limit ?",
      ]
    `);

    await knex("test.test").update({ isBoolean: true }).where("id", 1);
    queries = [];
    expect(await table.read(knex, { isBoolean: "true" }, {}))
      .toMatchInlineSnapshot(`
      Object {
        "data": Array [
          Object {
            "_links": Object {},
            "_type": "test/test",
            "_url": "/test/test/1",
            "id": 1,
            "isBoolean": true,
            "numberCount": 0,
            "text": "text",
          },
        ],
        "meta": Object {
          "_collection": "test/test",
          "_links": Object {
            "count": "/test/test/count?isBoolean=true",
            "ids": "/test/test/ids?isBoolean=true",
          },
          "_type": "collection",
          "_url": "/test/test?isBoolean=true",
          "hasMore": false,
          "limit": 50,
          "page": 0,
        },
      }
    `);
    expect(queries).toMatchInlineSnapshot(`
      Array [
        "select test.id, test.is_boolean, test.number_count, test.text from test.test where test.is_boolean = ? order by test.id asc limit ?",
      ]
    `);

    await knex("test.test")
      .update({ isBoolean: false, numberCount: 1 })
      .where("id", 1);
    queries = [];
    expect(await table.read(knex, { numberCount: 1 }, {}))
      .toMatchInlineSnapshot(`
      Object {
        "data": Array [
          Object {
            "_links": Object {},
            "_type": "test/test",
            "_url": "/test/test/1",
            "id": 1,
            "isBoolean": false,
            "numberCount": 1,
            "text": "text",
          },
        ],
        "meta": Object {
          "_collection": "test/test",
          "_links": Object {
            "count": "/test/test/count?numberCount=1",
            "ids": "/test/test/ids?numberCount=1",
          },
          "_type": "collection",
          "_url": "/test/test?numberCount=1",
          "hasMore": false,
          "limit": 50,
          "page": 0,
        },
      }
    `);
    expect(queries).toMatchInlineSnapshot(`
      Array [
        "select test.id, test.is_boolean, test.number_count, test.text from test.test where test.number_count = ? order by test.id asc limit ?",
      ]
    `);

    queries = [];
    expect(
      await table
        .read(knex, { id: 123 }, {})
        .catch((e: NotFoundError) => [e.statusCode, e.message])
    ).toMatchInlineSnapshot(`
      Object {
        "data": Array [],
        "meta": Object {
          "_collection": "test/test",
          "_links": Object {
            "count": "/test/test/count?id=123",
            "ids": "/test/test/ids?id=123",
          },
          "_type": "collection",
          "_url": "/test/test?id=123",
          "hasMore": false,
          "limit": 50,
          "page": 0,
        },
      }
    `);
    expect(queries).toMatchInlineSnapshot(`
      Array [
        "select test.id, test.is_boolean, test.number_count, test.text from test.test where test.id = ? order by test.id asc limit ?",
      ]
    `);

    queries = [];
    expect(
      await table
        .read(knex, { id: 123 }, {}, false)
        .catch((e: NotFoundError) => [e.statusCode, e.message])
    ).toMatchInlineSnapshot(`
      Array [
        404,
        "Not Found",
      ]
    `);
    expect(queries).toMatchInlineSnapshot(`
      Array [
        "select test.id, test.is_boolean, test.number_count, test.text from test.test where test.id = ? limit ?",
      ]
    `);
  });

  it("read relations", async () => {
    await knex.schema.withSchema("test").createTable("users", (t) => {
      t.bigIncrements("id").primary();
    });

    await knex.schema.withSchema("test").createTable("posts", (t) => {
      t.bigIncrements("id").primary();
      t.bigInteger("user_id").references("id").inTable("test.users");
    });

    const users = new Table({
      schemaName: "test",
      tableName: "users",
    });

    const posts = new Table({
      schemaName: "test",
      tableName: "posts",
    });

    await users.init(knex);
    await posts.init(knex);
    users.linkTables([users, posts]);
    posts.linkTables([users, posts]);

    const [user] = await knex("test.users").insert({}).returning("*");

    await knex("test.posts").insert({ userId: user.id }).returning("*");

    queries = [];
    expect(await users.read(knex, {}, {})).toMatchInlineSnapshot(`
      Object {
        "data": Array [
          Object {
            "_links": Object {
              "posts": "/test/posts?userId=1",
            },
            "_type": "test/users",
            "_url": "/test/users/1",
            "id": 1,
          },
        ],
        "meta": Object {
          "_collection": "test/users",
          "_links": Object {
            "count": "/test/users/count",
            "ids": "/test/users/ids",
          },
          "_type": "collection",
          "_url": "/test/users",
          "hasMore": false,
          "limit": 50,
          "page": 0,
        },
      }
    `);
    expect(queries).toMatchInlineSnapshot(`
      Array [
        "select users.id from test.users order by users.id asc limit ?",
      ]
    `);

    queries = [];
    expect(await posts.read(knex, {}, {})).toMatchInlineSnapshot(`
      Object {
        "data": Array [
          Object {
            "_links": Object {
              "user": "/test/users/1",
            },
            "_type": "test/posts",
            "_url": "/test/posts/1",
            "id": 1,
            "userId": 1,
          },
        ],
        "meta": Object {
          "_collection": "test/posts",
          "_links": Object {
            "count": "/test/posts/count",
            "ids": "/test/posts/ids",
          },
          "_type": "collection",
          "_url": "/test/posts",
          "hasMore": false,
          "limit": 50,
          "page": 0,
        },
      }
    `);
    expect(queries).toMatchInlineSnapshot(`
      Array [
        "select posts.id, posts.user_id from test.posts order by posts.id asc limit ?",
      ]
    `);

    queries = [];
    expect(await posts.read(knex, { include: "user", id: 1 }, {}, false))
      .toMatchInlineSnapshot(`
      Object {
        "_links": Object {
          "user": "/test/users/1",
        },
        "_type": "test/posts",
        "_url": "/test/posts/1",
        "id": 1,
        "user": Object {
          "_links": Object {
            "posts": "/test/posts?userId=1",
          },
          "_type": "test/users",
          "_url": "/test/users/1",
          "id": 1,
        },
        "userId": 1,
      }
    `);
    expect(queries).toMatchInlineSnapshot(`
      Array [
        "select posts.id, posts.user_id, (select row_to_json(users_sub_query) from (select users.id from test.users where users.id = posts.user_id limit ?) users_sub_query) as user from test.posts where posts.id = ? limit ?",
      ]
    `);

    queries = [];
    expect(await users.read(knex, { include: "posts", id: 1 }, {}, false))
      .toMatchInlineSnapshot(`
      Object {
        "_links": Object {
          "posts": "/test/posts?userId=1",
        },
        "_type": "test/users",
        "_url": "/test/users/1",
        "id": 1,
        "posts": Array [
          Object {
            "_links": Object {
              "user": "/test/users/1",
            },
            "_type": "test/posts",
            "_url": "/test/posts/1",
            "id": 1,
            "userId": 1,
          },
        ],
      }
    `);
    expect(queries).toMatchInlineSnapshot(`
      Array [
        "select users.id, array(select row_to_json(posts_sub_query) from (select posts.id, posts.user_id from test.posts where posts.user_id = users.id limit ?) posts_sub_query) as posts from test.users where users.id = ? limit ?",
      ]
    `);

    queries = [];
    expect(await users.read(knex, { include: "bogus" }, {}))
      .toMatchInlineSnapshot(`
      Object {
        "data": Array [
          Object {
            "_links": Object {
              "posts": "/test/posts?userId=1",
            },
            "_type": "test/users",
            "_url": "/test/users/1",
            "id": 1,
          },
        ],
        "meta": Object {
          "_collection": "test/users",
          "_links": Object {
            "count": "/test/users/count?include=bogus",
            "ids": "/test/users/ids?include=bogus",
          },
          "_type": "collection",
          "_url": "/test/users?include=bogus",
          "hasMore": false,
          "limit": 50,
          "page": 0,
        },
      }
    `);
    expect(queries).toMatchInlineSnapshot(`
      Array [
        "select users.id from test.users order by users.id asc limit ?",
      ]
    `);
  });

  it("forwards query params to relations", async () => {
    await knex.schema.withSchema("test").createTable("users", (t) => {
      t.bigIncrements("id").primary();
    });

    await knex.schema.withSchema("test").createTable("posts", (t) => {
      t.bigIncrements("id").primary();
      t.bigInteger("user_id").references("id").inTable("test.users");
    });

    const users = new Table({
      schemaName: "test",
      tableName: "users",
      forwardQueryParams: ["token"],
      eagerGetters: {
        async postCount(stmt) {
          stmt
            .from("test.posts")
            .whereRaw("user_id=??", [`${this.alias}.id`])
            .count()
            .first();
        },
      },
    });

    const posts = new Table({
      schemaName: "test",
      tableName: "posts",
      forwardQueryParams: ["token"],
    });

    await users.init(knex);
    await posts.init(knex);
    users.linkTables([users, posts]);
    posts.linkTables([users, posts]);

    const [user] = await knex("test.users").insert({}).returning("*");

    await knex("test.posts").insert({ userId: user.id }).returning("*");

    queries = [];
    expect(await users.read(knex, { token: "123" }, {})).toMatchInlineSnapshot(`
      Object {
        "data": Array [
          Object {
            "_links": Object {
              "postCount": "/test/users/1/postCount?token=123",
              "posts": "/test/posts?token=123&userId=1",
            },
            "_type": "test/users",
            "_url": "/test/users/1?token=123",
            "id": 1,
          },
        ],
        "meta": Object {
          "_collection": "test/users",
          "_links": Object {
            "count": "/test/users/count?token=123",
            "ids": "/test/users/ids?token=123",
          },
          "_type": "collection",
          "_url": "/test/users?token=123",
          "hasMore": false,
          "limit": 50,
          "page": 0,
        },
      }
    `);
    expect(queries).toMatchInlineSnapshot(`
      Array [
        "select users.id from test.users order by users.id asc limit ?",
      ]
    `);

    queries = [];
    expect(await posts.read(knex, { token: "123" }, {})).toMatchInlineSnapshot(`
      Object {
        "data": Array [
          Object {
            "_links": Object {
              "user": "/test/users/1?token=123",
            },
            "_type": "test/posts",
            "_url": "/test/posts/1?token=123",
            "id": 1,
            "userId": 1,
          },
        ],
        "meta": Object {
          "_collection": "test/posts",
          "_links": Object {
            "count": "/test/posts/count?token=123",
            "ids": "/test/posts/ids?token=123",
          },
          "_type": "collection",
          "_url": "/test/posts?token=123",
          "hasMore": false,
          "limit": 50,
          "page": 0,
        },
      }
    `);
    expect(queries).toMatchInlineSnapshot(`
      Array [
        "select posts.id, posts.user_id from test.posts order by posts.id asc limit ?",
      ]
    `);

    queries = [];
    expect(
      await posts.read(
        knex,
        { include: "user", id: 1, token: "123" },
        {},
        false
      )
    ).toMatchInlineSnapshot(`
      Object {
        "_links": Object {
          "user": "/test/users/1?token=123",
        },
        "_type": "test/posts",
        "_url": "/test/posts/1?token=123",
        "id": 1,
        "user": Object {
          "_links": Object {
            "postCount": "/test/users/1/postCount?token=123",
            "posts": "/test/posts?token=123&userId=1",
          },
          "_type": "test/users",
          "_url": "/test/users/1?token=123",
          "id": 1,
        },
        "userId": 1,
      }
    `);
    expect(queries).toMatchInlineSnapshot(`
      Array [
        "select posts.id, posts.user_id, (select row_to_json(users_sub_query) from (select users.id from test.users where users.id = posts.user_id limit ?) users_sub_query) as user from test.posts where posts.id = ? limit ?",
      ]
    `);

    queries = [];
    expect(
      await users.read(
        knex,
        { include: "posts", id: 1, token: "123" },
        {},
        false
      )
    ).toMatchInlineSnapshot(`
      Object {
        "_links": Object {
          "postCount": "/test/users/1/postCount?token=123",
          "posts": "/test/posts?token=123&userId=1",
        },
        "_type": "test/users",
        "_url": "/test/users/1?token=123",
        "id": 1,
        "posts": Array [
          Object {
            "_links": Object {
              "user": "/test/users/1?token=123",
            },
            "_type": "test/posts",
            "_url": "/test/posts/1?token=123",
            "id": 1,
            "userId": 1,
          },
        ],
      }
    `);
    expect(queries).toMatchInlineSnapshot(`
      Array [
        "select users.id, array(select row_to_json(posts_sub_query) from (select posts.id, posts.user_id from test.posts where posts.user_id = users.id limit ?) posts_sub_query) as posts from test.users where users.id = ? limit ?",
      ]
    `);

    queries = [];
    expect(
      await users.read(
        knex,
        { include: ["posts", "postCount"], id: 1, token: "123" },
        {},
        false
      )
    ).toMatchInlineSnapshot(`
      Object {
        "_links": Object {
          "postCount": "/test/users/1/postCount?token=123",
          "posts": "/test/posts?token=123&userId=1",
        },
        "_type": "test/users",
        "_url": "/test/users/1?token=123",
        "id": 1,
        "postCount": Object {
          "count": 1,
        },
        "posts": Array [
          Object {
            "_links": Object {
              "user": "/test/users/1?token=123",
            },
            "_type": "test/posts",
            "_url": "/test/posts/1?token=123",
            "id": 1,
            "userId": 1,
          },
        ],
      }
    `);
    expect(queries).toMatchInlineSnapshot(`
      Array [
        "select users.id, array(select row_to_json(posts_sub_query) from (select posts.id, posts.user_id from test.posts where posts.user_id = users.id limit ?) posts_sub_query) as posts, (select row_to_json(i) from (select count(*) from test.posts where user_id=users.id limit ?) as i) as post_count from test.users where users.id = ? limit ?",
      ]
    `);

    queries = [];
    expect(await users.read(knex, { include: "bogus", token: "123" }, {}))
      .toMatchInlineSnapshot(`
      Object {
        "data": Array [
          Object {
            "_links": Object {
              "postCount": "/test/users/1/postCount?token=123",
              "posts": "/test/posts?token=123&userId=1",
            },
            "_type": "test/users",
            "_url": "/test/users/1?token=123",
            "id": 1,
          },
        ],
        "meta": Object {
          "_collection": "test/users",
          "_links": Object {
            "count": "/test/users/count?include=bogus&token=123",
            "ids": "/test/users/ids?include=bogus&token=123",
          },
          "_type": "collection",
          "_url": "/test/users?include=bogus&token=123",
          "hasMore": false,
          "limit": 50,
          "page": 0,
        },
      }
    `);
    expect(queries).toMatchInlineSnapshot(`
      Array [
        "select users.id from test.users order by users.id asc limit ?",
      ]
    `);
  });

  it("reads relations with multiple references (failure)", async () => {
    await knex.schema.withSchema("test").createTable("versions", (t) => {
      t.bigIncrements("id").primary();
    });

    await knex.schema.withSchema("test").createTable("docs", (t) => {
      t.bigIncrements("id").primary();
      t.bigInteger("versionId")
        .references("id")
        .inTable("test.versions")
        .notNullable();
      t.bigInteger("firstVersionId")
        .references("id")
        .inTable("test.versions")
        .notNullable();
    });

    const [version] = await knex("test.versions").insert({}).returning("*");

    await knex("test.docs")
      .insert({
        versionId: version.id,
        firstVersionId: version.id,
      })
      .returning("*");

    const versions = new Table({
      schemaName: "test",
      tableName: "versions",
    });

    const docs = new Table({
      schemaName: "test",
      tableName: "docs",
    });

    await versions.init(knex);
    await docs.init(knex);

    expect(() => versions.linkTables([docs])).toThrow();
  });

  it("reads relations with multiple references", async () => {
    await knex.schema.withSchema("test").createTable("versions", (t) => {
      t.bigIncrements("id").primary();
    });

    await knex.schema.withSchema("test").createTable("docs", (t) => {
      t.bigIncrements("id").primary();
      t.bigInteger("versionId")
        .references("id")
        .inTable("test.versions")
        .notNullable();
      t.bigInteger("firstVersionId")
        .references("id")
        .inTable("test.versions")
        .notNullable();
    });

    const [version] = await knex("test.versions").insert({}).returning("*");

    await knex("test.docs")
      .insert({
        versionId: version.id,
        firstVersionId: version.id,
      })
      .returning("*");

    const versions = new Table({
      schemaName: "test",
      tableName: "versions",
    });

    const docs = new Table({
      schemaName: "test",
      tableName: "docs",
      inverseOfColumnName: {
        versionId: "headDocs",
        firstVersionId: "firstDocs",
      },
    });

    await versions.init(knex);
    await docs.init(knex);
    versions.linkTables([versions, docs]);
    docs.linkTables([versions, docs]);

    queries = [];
    expect(await docs.read(knex, { include: ["version", "firstVersion"] }, {}))
      .toMatchInlineSnapshot(`
      Object {
        "data": Array [
          Object {
            "_links": Object {
              "firstVersion": "/test/versions/1",
              "version": "/test/versions/1",
            },
            "_type": "test/docs",
            "_url": "/test/docs/1",
            "firstVersion": Object {
              "_links": Object {
                "firstDocs": "/test/docs?firstVersionId=1",
                "headDocs": "/test/docs?versionId=1",
              },
              "_type": "test/versions",
              "_url": "/test/versions/1",
              "id": 1,
            },
            "firstVersionId": 1,
            "id": 1,
            "version": Object {
              "_links": Object {
                "firstDocs": "/test/docs?firstVersionId=1",
                "headDocs": "/test/docs?versionId=1",
              },
              "_type": "test/versions",
              "_url": "/test/versions/1",
              "id": 1,
            },
            "versionId": 1,
          },
        ],
        "meta": Object {
          "_collection": "test/docs",
          "_links": Object {
            "count": "/test/docs/count?include[]=version&include[]=firstVersion",
            "ids": "/test/docs/ids?include[]=version&include[]=firstVersion",
          },
          "_type": "collection",
          "_url": "/test/docs?include[]=version&include[]=firstVersion",
          "hasMore": false,
          "limit": 50,
          "page": 0,
        },
      }
    `);
    expect(queries).toMatchInlineSnapshot(`
      Array [
        "select docs.id, docs.version_id, docs.first_version_id, (select row_to_json(versions_sub_query) from (select versions.id from test.versions where versions.id = docs.version_id limit ?) versions_sub_query) as version, (select row_to_json(versions_sub_query) from (select versions.id from test.versions where versions.id = docs.first_version_id limit ?) versions_sub_query) as first_version from test.docs order by docs.id asc limit ?",
      ]
    `);

    queries = [];
    expect(
      await versions.read(knex, { include: ["headDocs", "firstDocs"] }, {})
    ).toMatchInlineSnapshot(`
      Object {
        "data": Array [
          Object {
            "_links": Object {
              "firstDocs": "/test/docs?firstVersionId=1",
              "headDocs": "/test/docs?versionId=1",
            },
            "_type": "test/versions",
            "_url": "/test/versions/1",
            "firstDocs": Array [
              Object {
                "_links": Object {
                  "firstVersion": "/test/versions/1",
                  "version": "/test/versions/1",
                },
                "_type": "test/docs",
                "_url": "/test/docs/1",
                "firstVersionId": 1,
                "id": 1,
                "versionId": 1,
              },
            ],
            "headDocs": Array [
              Object {
                "_links": Object {
                  "firstVersion": "/test/versions/1",
                  "version": "/test/versions/1",
                },
                "_type": "test/docs",
                "_url": "/test/docs/1",
                "firstVersionId": 1,
                "id": 1,
                "versionId": 1,
              },
            ],
            "id": 1,
          },
        ],
        "meta": Object {
          "_collection": "test/versions",
          "_links": Object {
            "count": "/test/versions/count?include[]=headDocs&include[]=firstDocs",
            "ids": "/test/versions/ids?include[]=headDocs&include[]=firstDocs",
          },
          "_type": "collection",
          "_url": "/test/versions?include[]=headDocs&include[]=firstDocs",
          "hasMore": false,
          "limit": 50,
          "page": 0,
        },
      }
    `);
    expect(queries).toMatchInlineSnapshot(`
      Array [
        "select versions.id, array(select row_to_json(docs_sub_query) from (select docs.id, docs.version_id, docs.first_version_id from test.docs where docs.version_id = versions.id limit ?) docs_sub_query) as head_docs, array(select row_to_json(docs_sub_query) from (select docs.id, docs.version_id, docs.first_version_id from test.docs where docs.first_version_id = versions.id limit ?) docs_sub_query) as first_docs from test.versions order by versions.id asc limit ?",
      ]
    `);
  });

  it("writes", async () => {
    await knex.schema.withSchema("test").createTable("test", (t) => {
      t.bigIncrements("id").primary();
      t.boolean("is_boolean").notNullable().defaultTo(false);
      t.integer("number_count").notNullable().defaultTo(0);
      t.specificType("text", "character varying(10)")
        .notNullable()
        .defaultTo("text");
    });

    const table = new Table({
      schemaName: "test",
      tableName: "test",
    });

    await table.init(knex);

    queries = [];
    expect(await table.write(knex, {}, {})).toMatchInlineSnapshot(`
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
            "schemaName": "test",
            "tableName": "test",
          },
        ],
        "result": Object {
          "_links": Object {},
          "_type": "test/test",
          "_url": "/test/test/1",
          "id": 1,
          "isBoolean": false,
          "numberCount": 0,
          "text": "text",
        },
      }
    `);
    expect(queries).toMatchInlineSnapshot(`
      Array [
        "insert into test.test default values returning *",
        "select test.id, test.is_boolean, test.number_count, test.text from test.test where test.id = ? limit ?",
      ]
    `);
  });

  it("validates", async () => {
    await knex.schema.withSchema("test").createTable("test", (t) => {
      t.bigIncrements("id").primary();
      t.boolean("is_boolean").notNullable().defaultTo(false);
      t.timestamp("date").notNullable().defaultTo("1999-01-08 04:05:06");
      t.integer("number_count").notNullable().defaultTo(0);
      t.specificType("text", "character varying(5)")
        .notNullable()
        .defaultTo("text");
      t.specificType("arr", "text[]").defaultTo("{}").notNullable();
    });

    const table = new Table({
      schemaName: "test",
      tableName: "test",
    });

    await table.init(knex);

    queries = [];
    expect(
      await table
        .write(knex, { numberCount: null }, {})
        .catch((e: BadRequestError) => e.body)
    ).toMatchInlineSnapshot(`
      Object {
        "errors": Object {
          "numberCount": "is a required field",
        },
      }
    `);
    expect(queries).toMatchInlineSnapshot(`Array []`);

    queries = [];
    expect(
      await table
        .write(knex, { numberCount: "a" }, {})
        .catch((e: BadRequestError) => e.body)
    ).toMatchInlineSnapshot(`
      Object {
        "errors": Object {
          "numberCount": "must be a \`number\` type, but the final value was: \`\\"a\\"\`.",
        },
      }
    `);
    expect(queries).toMatchInlineSnapshot(`Array []`);

    queries = [];
    expect(
      await table
        .write(knex, { text: "01234567890" }, {})
        .catch((e: BadRequestError) => e.body)
    ).toMatchInlineSnapshot(`
      Object {
        "errors": Object {
          "text": "must be at most 5 characters",
        },
      }
    `);
    expect(queries).toMatchInlineSnapshot(`Array []`);

    queries = [];
    expect(await table.write(knex, { isBoolean: "false" }, {}))
      .toMatchInlineSnapshot(`
      Object {
        "changes": Array [
          Object {
            "mode": "insert",
            "row": Object {
              "arr": Array [],
              "date": 1999-01-08T10:05:06.000Z,
              "id": 1,
              "isBoolean": false,
              "numberCount": 0,
              "text": "text",
            },
            "schemaName": "test",
            "tableName": "test",
          },
        ],
        "result": Object {
          "_links": Object {},
          "_type": "test/test",
          "_url": "/test/test/1",
          "arr": Array [],
          "date": 1999-01-08T10:05:06.000Z,
          "id": 1,
          "isBoolean": false,
          "numberCount": 0,
          "text": "text",
        },
      }
    `);
    expect(queries).toMatchInlineSnapshot(`
      Array [
        "insert into test.test (is_boolean) values (?) returning *",
        "select test.id, test.is_boolean, test.date, test.number_count, test.text, test.arr from test.test where test.id = ? limit ?",
      ]
    `);

    await knex("test.test").truncate();
    queries = [];
    expect(
      await table.write(
        knex,
        { date: new Date("2000-01-01 04:05:06").toISOString() },
        {}
      )
    ).toMatchInlineSnapshot(`
      Object {
        "changes": Array [
          Object {
            "mode": "insert",
            "row": Object {
              "arr": Array [],
              "date": 2000-01-01T11:05:06.000Z,
              "id": 1,
              "isBoolean": false,
              "numberCount": 0,
              "text": "text",
            },
            "schemaName": "test",
            "tableName": "test",
          },
        ],
        "result": Object {
          "_links": Object {},
          "_type": "test/test",
          "_url": "/test/test/1",
          "arr": Array [],
          "date": 2000-01-01T11:05:06.000Z,
          "id": 1,
          "isBoolean": false,
          "numberCount": 0,
          "text": "text",
        },
      }
    `);
    expect(queries).toMatchInlineSnapshot(`
      Array [
        "insert into test.test (date) values (?) returning *",
        "select test.id, test.is_boolean, test.date, test.number_count, test.text, test.arr from test.test where test.id = ? limit ?",
      ]
    `);

    queries = [];
    expect(
      await table
        .write(knex, { arr: [true, 1, "text", []] }, {})
        .catch((e: BadRequestError) => e.body)
    ).toMatchInlineSnapshot(`
      Object {
        "errors": Object {
          "arr": Object {
            "0": "must be a \`string\` type, but the final value was: \`true\`.",
            "1": "must be a \`string\` type, but the final value was: \`1\`.",
            "3": "must be a \`string\` type, but the final value was: \`[]\`.",
          },
        },
      }
    `);
    expect(queries).toMatchInlineSnapshot(`Array []`);

    queries = [];
    expect(
      await table
        .write(knex, { id: "abc" }, {})
        .catch((e: BadRequestError) => e.body)
    ).toMatchInlineSnapshot(`
      Object {
        "errors": Object {
          "id": "must be a \`number\` type, but the final value was: \`\\"abc\\"\`.",
        },
      }
    `);
    expect(queries).toMatchInlineSnapshot(`Array []`);

    queries = [];
    expect(
      await table
        .write(knex, { id: 123 }, {})
        .catch((e: NotFoundError) => [e.statusCode, e.message])
    ).toMatchInlineSnapshot(`
      Array [
        401,
        "Unauthorized",
      ]
    `);
    expect(queries).toMatchInlineSnapshot(`
      Array [
        "select test.id, test.is_boolean, test.date, test.number_count, test.text, test.arr from test.test where test.id = ? limit ?",
      ]
    `);
  });

  it("validates extended schemas", async () => {
    await knex.schema.withSchema("test").createTable("test", (t) => {
      t.bigIncrements("id").primary();
      t.text("email").notNullable();
    });

    const table = new Table({
      schemaName: "test",
      tableName: "test",
      schema: {
        email: string().email().min(1),
      },
    });

    await table.init(knex);

    queries = [];
    expect(
      await table
        .write(knex, { email: null }, {})
        .catch((e: BadRequestError) => e.body)
    ).toMatchInlineSnapshot(`
      Object {
        "errors": Object {
          "email": "is a required field",
        },
      }
    `);
    expect(queries).toMatchInlineSnapshot(`Array []`);

    queries = [];
    expect(
      await table
        .write(knex, { email: "" }, {})
        .catch((e: BadRequestError) => e.body)
    ).toMatchInlineSnapshot(`
      Object {
        "errors": Object {
          "email": "is a required field",
        },
      }
    `);
    expect(queries).toMatchInlineSnapshot(`Array []`);

    queries = [];
    expect(await table.write(knex, { email: "test@test.com" }, {}))
      .toMatchInlineSnapshot(`
      Object {
        "changes": Array [
          Object {
            "mode": "insert",
            "row": Object {
              "email": "test@test.com",
              "id": 1,
            },
            "schemaName": "test",
            "tableName": "test",
          },
        ],
        "result": Object {
          "_links": Object {},
          "_type": "test/test",
          "_url": "/test/test/1",
          "email": "test@test.com",
          "id": 1,
        },
      }
    `);
    expect(queries).toMatchInlineSnapshot(`
      Array [
        "insert into test.test (email) values (?) returning *",
        "select test.id, test.email from test.test where test.id = ? limit ?",
      ]
    `);
  });

  it("validates unique keys", async () => {
    await knex.schema.withSchema("test").createTable("test", (t) => {
      t.bigIncrements("id").primary();
      t.text("username").unique().notNullable();
    });

    const table = new Table({
      schemaName: "test",
      tableName: "test",
    });

    await table.init(knex);

    queries = [];
    expect(await table.write(knex, { username: "abc" }, {}))
      .toMatchInlineSnapshot(`
      Object {
        "changes": Array [
          Object {
            "mode": "insert",
            "row": Object {
              "id": 1,
              "username": "abc",
            },
            "schemaName": "test",
            "tableName": "test",
          },
        ],
        "result": Object {
          "_links": Object {},
          "_type": "test/test",
          "_url": "/test/test/1",
          "id": 1,
          "username": "abc",
        },
      }
    `);
    expect(queries).toMatchInlineSnapshot(`
      Array [
        "select test.id, test.username from test.test where test.username = ? limit ?",
        "insert into test.test (username) values (?) returning *",
        "select test.id, test.username from test.test where test.id = ? limit ?",
      ]
    `);

    queries = [];
    expect(
      await table
        .write(knex, { username: "abc" }, {})
        .catch((e: BadRequestError) => e.body)
    ).toMatchInlineSnapshot(`
      Object {
        "errors": Object {
          "username": "is already in use",
        },
      }
    `);
    expect(queries).toMatchInlineSnapshot(`
      Array [
        "select test.id, test.username from test.test where test.username = ? limit ?",
      ]
    `);
  });

  it("validates compound unique keys", async () => {
    await knex.schema.withSchema("test").createTable("test", (t) => {
      t.bigIncrements("id").primary();
      t.text("org").notNullable();
      t.text("username").notNullable();
      t.unique(["org", "username"]);
    });

    const table = new Table({
      schemaName: "test",
      tableName: "test",
    });

    await table.init(knex);

    await knex("test.test").truncate();
    queries = [];
    expect(await table.write(knex, { username: "abc", org: "a" }, {}))
      .toMatchInlineSnapshot(`
      Object {
        "changes": Array [
          Object {
            "mode": "insert",
            "row": Object {
              "id": 1,
              "org": "a",
              "username": "abc",
            },
            "schemaName": "test",
            "tableName": "test",
          },
        ],
        "result": Object {
          "_links": Object {},
          "_type": "test/test",
          "_url": "/test/test/1",
          "id": 1,
          "org": "a",
          "username": "abc",
        },
      }
    `);
    expect(queries).toMatchInlineSnapshot(`
      Array [
        "select test.id, test.org, test.username from test.test where test.org = ? and test.username = ? limit ?",
        "select test.id, test.org, test.username from test.test where test.org = ? and test.username = ? limit ?",
        "insert into test.test (org, username) values (?, ?) returning *",
        "select test.id, test.org, test.username from test.test where test.id = ? limit ?",
      ]
    `);

    await knex("test.test").truncate();
    queries = [];
    expect(
      await table
        .write(knex, { username: "abc", org: "a" }, {})
        .catch((e: BadRequestError) => e.body)
    ).toMatchInlineSnapshot(`
      Object {
        "changes": Array [
          Object {
            "mode": "insert",
            "row": Object {
              "id": 1,
              "org": "a",
              "username": "abc",
            },
            "schemaName": "test",
            "tableName": "test",
          },
        ],
        "result": Object {
          "_links": Object {},
          "_type": "test/test",
          "_url": "/test/test/1",
          "id": 1,
          "org": "a",
          "username": "abc",
        },
      }
    `);
    expect(queries).toMatchInlineSnapshot(`
      Array [
        "select test.id, test.org, test.username from test.test where test.org = ? and test.username = ? limit ?",
        "select test.id, test.org, test.username from test.test where test.org = ? and test.username = ? limit ?",
        "insert into test.test (org, username) values (?, ?) returning *",
        "select test.id, test.org, test.username from test.test where test.id = ? limit ?",
      ]
    `);

    await knex("test.test").truncate();
    queries = [];
    expect(await table.write(knex, { username: "abc", org: "b" }, {}))
      .toMatchInlineSnapshot(`
      Object {
        "changes": Array [
          Object {
            "mode": "insert",
            "row": Object {
              "id": 1,
              "org": "b",
              "username": "abc",
            },
            "schemaName": "test",
            "tableName": "test",
          },
        ],
        "result": Object {
          "_links": Object {},
          "_type": "test/test",
          "_url": "/test/test/1",
          "id": 1,
          "org": "b",
          "username": "abc",
        },
      }
    `);
    expect(queries).toMatchInlineSnapshot(`
      Array [
        "select test.id, test.org, test.username from test.test where test.org = ? and test.username = ? limit ?",
        "select test.id, test.org, test.username from test.test where test.org = ? and test.username = ? limit ?",
        "insert into test.test (org, username) values (?, ?) returning *",
        "select test.id, test.org, test.username from test.test where test.id = ? limit ?",
      ]
    `);

    await knex("test.test").truncate();
    queries = [];
    expect(
      await table.write(knex, {}, {}).catch((e: BadRequestError) => e.body)
    ).toMatchInlineSnapshot(`
      Object {
        "errors": Object {
          "org": "is a required field",
          "username": "is a required field",
        },
      }
    `);
    expect(queries).toMatchInlineSnapshot(`Array []`);

    await knex("test.test").truncate();
    queries = [];
    expect(
      await table
        .write(knex, { username: "xyz" }, {})
        .catch((e: BadRequestError) => e.body)
    ).toMatchInlineSnapshot(`
      Object {
        "errors": Object {
          "org": "is a required field",
        },
      }
    `);
    expect(queries).toMatchInlineSnapshot(`Array []`);

    await knex("test.test").truncate();
    const { result: row } = await table.write(
      knex,
      { username: "xyz", org: "org" },
      {}
    );

    queries = [];
    expect(
      await table.write(knex, { id: row!.id, username: "xyb", org: "org" }, {})
    ).toMatchInlineSnapshot(`
      Object {
        "changes": Array [
          Object {
            "mode": "update",
            "row": Object {
              "id": 1,
              "org": "org",
              "username": "xyb",
            },
            "schemaName": "test",
            "tableName": "test",
          },
        ],
        "result": Object {
          "_links": Object {},
          "_type": "test/test",
          "_url": "/test/test/1",
          "id": 1,
          "org": "org",
          "username": "xyb",
        },
      }
    `);
    expect(queries).toMatchInlineSnapshot(`
      Array [
        "select test.id, test.org, test.username from test.test where test.id = ? limit ?",
        "select test.id, test.org, test.username from test.test where not (test.id = ?) and test.org = ? and test.username = ? limit ?",
        "select test.id, test.org, test.username from test.test where not (test.id = ?) and test.org = ? and test.username = ? limit ?",
        "select test.id, test.org, test.username from test.test where test.id = ? limit ?",
        "update test.test set username = ? where test.id = ?",
        "select test.id, test.org, test.username from test.test where test.id = ? limit ?",
      ]
    `);

    queries = [];
    expect(await table.write(knex, { id: row!.id, _delete: true }, {}))
      .toMatchInlineSnapshot(`
      Object {
        "changes": Array [
          Object {
            "mode": "delete",
            "row": Object {
              "id": 1,
              "org": "org",
              "username": "xyb",
            },
            "schemaName": "test",
            "tableName": "test",
          },
        ],
        "result": null,
      }
    `);
    expect(queries).toMatchInlineSnapshot(`
      Array [
        "select test.id, test.org, test.username from test.test where test.id = ? limit ?",
        "delete from test.test where test.id = ?",
      ]
    `);
  });

  it("validates deep", async () => {
    await knex.schema.withSchema("test").createTable("users", (t) => {
      t.bigIncrements("id").primary();
      t.text("name").notNullable();
    });

    await knex.schema.withSchema("test").createTable("posts", (t) => {
      t.bigIncrements("id").primary();
      t.bigInteger("user_id")
        .references("id")
        .inTable("test.users")
        .onDelete("cascade");
      t.text("body").notNullable();
    });

    const users = new Table({
      schemaName: "test",
      tableName: "users",
    });

    const posts = new Table({
      schemaName: "test",
      tableName: "posts",
    });

    await users.init(knex);
    await posts.init(knex);
    users.linkTables([users, posts]);
    posts.linkTables([users, posts]);

    queries = [];
    expect(
      await users
        .write(
          knex,
          {
            name: "a",
            posts: [
              {
                body: "123",
              },
              { body: null },
            ],
          },
          {}
        )
        .catch((e: BadRequestError) => e.body)
    ).toMatchInlineSnapshot(`
      Object {
        "errors": Object {
          "posts": Object {
            "1": Object {
              "body": "is a required field",
            },
          },
        },
      }
    `);
    expect(queries).toMatchInlineSnapshot(`Array []`);

    queries = [];
    expect(await users.write(knex, { name: "a" }, {})).toMatchInlineSnapshot(`
      Object {
        "changes": Array [
          Object {
            "mode": "insert",
            "row": Object {
              "id": 1,
              "name": "a",
            },
            "schemaName": "test",
            "tableName": "users",
          },
        ],
        "result": Object {
          "_links": Object {
            "posts": "/test/posts?userId=1",
          },
          "_type": "test/users",
          "_url": "/test/users/1",
          "id": 1,
          "name": "a",
        },
      }
    `);
    expect(queries).toMatchInlineSnapshot(`
      Array [
        "insert into test.users (name) values (?) returning *",
        "select users.id, users.name from test.users where users.id = ? limit ?",
      ]
    `);

    queries = [];
    expect(
      await users.write(
        knex,
        { name: "a", posts: [{ body: "a" }, { body: "b" }] },
        {}
      )
    ).toMatchInlineSnapshot(`
      Object {
        "changes": Array [
          Object {
            "mode": "insert",
            "row": Object {
              "id": 2,
              "name": "a",
            },
            "schemaName": "test",
            "tableName": "users",
          },
          Object {
            "mode": "insert",
            "row": Object {
              "body": "a",
              "id": 1,
              "userId": 2,
            },
            "schemaName": "test",
            "tableName": "posts",
          },
          Object {
            "mode": "insert",
            "row": Object {
              "body": "b",
              "id": 2,
              "userId": 2,
            },
            "schemaName": "test",
            "tableName": "posts",
          },
        ],
        "result": Object {
          "_links": Object {
            "posts": "/test/posts?userId=2",
          },
          "_type": "test/users",
          "_url": "/test/users/2",
          "id": 2,
          "name": "a",
          "posts": Array [
            Object {
              "_links": Object {
                "user": "/test/users/2",
              },
              "_type": "test/posts",
              "_url": "/test/posts/1",
              "body": "a",
              "id": 1,
              "userId": 2,
            },
            Object {
              "_links": Object {
                "user": "/test/users/2",
              },
              "_type": "test/posts",
              "_url": "/test/posts/2",
              "body": "b",
              "id": 2,
              "userId": 2,
            },
          ],
        },
      }
    `);
    expect(queries).toMatchInlineSnapshot(`
      Array [
        "insert into test.users (name) values (?) returning *",
        "select users.id, users.name from test.users where users.id = ? limit ?",
        "insert into test.posts (body, user_id) values (?, ?) returning *",
        "select posts.id, posts.user_id, posts.body from test.posts where posts.id = ? limit ?",
        "insert into test.posts (body, user_id) values (?, ?) returning *",
        "select posts.id, posts.user_id, posts.body from test.posts where posts.id = ? limit ?",
      ]
    `);

    queries = [];
    expect(
      await posts
        .write(knex, { body: "abc", user: {} }, {})
        .catch((e: BadRequestError) => e.body)
    ).toMatchInlineSnapshot(`
      Object {
        "errors": Object {
          "user": Object {
            "name": "is a required field",
          },
        },
      }
    `);
    expect(queries).toMatchInlineSnapshot(`Array []`);

    queries = [];
    expect(
      await posts
        .write(knex, { name: "a", body: "abc", user: { name: "a" } }, {})
        .catch((e: BadRequestError) => e.body)
    ).toMatchInlineSnapshot(`
      Object {
        "changes": Array [
          Object {
            "mode": "insert",
            "row": Object {
              "id": 3,
              "name": "a",
            },
            "schemaName": "test",
            "tableName": "users",
          },
          Object {
            "mode": "insert",
            "row": Object {
              "body": "abc",
              "id": 3,
              "userId": 3,
            },
            "schemaName": "test",
            "tableName": "posts",
          },
        ],
        "result": Object {
          "_links": Object {
            "user": "/test/users/3",
          },
          "_type": "test/posts",
          "_url": "/test/posts/3",
          "body": "abc",
          "id": 3,
          "user": Object {
            "_links": Object {
              "posts": "/test/posts?userId=3",
            },
            "_type": "test/users",
            "_url": "/test/users/3",
            "id": 3,
            "name": "a",
          },
          "userId": 3,
        },
      }
    `);
    expect(queries).toMatchInlineSnapshot(`
      Array [
        "insert into test.users (name) values (?) returning *",
        "select users.id, users.name from test.users where users.id = ? limit ?",
        "insert into test.posts (body, user_id) values (?, ?) returning *",
        "select posts.id, posts.user_id, posts.body from test.posts where posts.id = ? limit ?",
      ]
    `);

    queries = [];
    expect(
      await posts.write(knex, { id: 3, user: { id: 3, _delete: true } }, {})
    ).toMatchInlineSnapshot(`
      Object {
        "changes": Array [
          Object {
            "mode": "delete",
            "row": Object {
              "id": 3,
              "name": "a",
            },
            "schemaName": "test",
            "tableName": "users",
          },
        ],
        "result": null,
      }
    `);
    expect(queries).toMatchInlineSnapshot(`
      Array [
        "select posts.id, posts.user_id, posts.body from test.posts where posts.id = ? limit ?",
        "select users.id, users.name from test.users where users.id = ? limit ?",
        "delete from test.users where users.id = ?",
        "select posts.id, posts.user_id, posts.body from test.posts where posts.id = ? limit ?",
      ]
    `);

    const [user] = await knex("test.users")
      .insert({ name: "Yo" })
      .returning("*");
    const [post] = await knex("test.posts")
      .insert({ userId: user.id, body: "body" })
      .returning("*");
    queries = [];
    expect(
      await users.write(
        knex,
        { id: user.id, posts: [{ id: post.id, _delete: true }] },
        {}
      )
    ).toMatchInlineSnapshot(`
      Object {
        "changes": Array [
          Object {
            "mode": "delete",
            "row": Object {
              "body": "body",
              "id": 4,
              "userId": 4,
            },
            "schemaName": "test",
            "tableName": "posts",
          },
        ],
        "result": Object {
          "_links": Object {
            "posts": "/test/posts?userId=4",
          },
          "_type": "test/users",
          "_url": "/test/users/4",
          "id": 4,
          "name": "Yo",
          "posts": Array [],
        },
      }
    `);
    expect(queries).toMatchInlineSnapshot(`
      Array [
        "select users.id, users.name from test.users where users.id = ? limit ?",
        "select users.id, users.name from test.users where users.id = ? limit ?",
        "select posts.id, posts.user_id, posts.body from test.posts where posts.id = ? limit ?",
        "delete from test.posts where posts.id = ?",
      ]
    `);
  });

  it("counts", async () => {
    await knex.schema.withSchema("test").createTable("test", (t) => {
      t.bigIncrements("id").primary();
    });

    const table = new Table({
      schemaName: "test",
      tableName: "test",
    });

    await table.init(knex);

    for (let i = 0; i < 100; i++) await knex("test.test").insert({});

    queries = [];
    expect(await table.count(knex, {}, {})).toMatchInlineSnapshot(`100`);
    expect(queries).toMatchInlineSnapshot(`
      Array [
        "select count(distinct test.id) from test.test",
      ]
    `);
  });

  it("gets ids", async () => {
    await knex.schema.withSchema("test").createTable("test", (t) => {
      t.bigIncrements("id").primary();
    });

    const table = new Table({
      schemaName: "test",
      tableName: "test",
    });

    await table.init(knex);

    for (let i = 0; i < 100; i++) await knex("test.test").insert({});

    queries = [];
    expect((await table.ids(knex, {}, {})).meta).toMatchInlineSnapshot(`
      Object {
        "_links": Object {},
        "_url": "/test/test/ids",
        "hasMore": false,
        "limit": 1000,
        "page": 0,
      }
    `);
    expect(queries).toMatchInlineSnapshot(`
      Array [
        "select test.id from test.test limit ?",
      ]
    `);
  });

  it("supports eager getters", async () => {
    await knex.schema.withSchema("test").createTable("users", (t) => {
      t.bigIncrements("id").primary();
    });
    await knex.schema.withSchema("test").createTable("jobs", (t) => {
      t.bigIncrements("id").primary();
      t.boolean("active").defaultTo(true);
      t.integer("user_id").references("id").inTable("test.users");
    });

    await knex("test.users").insert({});
    await knex("test.jobs").insert({ userId: 1 }).returning("*");

    const users = new Table({
      schemaName: "test",
      tableName: "users",
      eagerGetters: {
        async activeJob(stmt) {
          stmt
            .from("test.jobs")
            .where("jobs.active", true)
            .whereRaw(`jobs.user_id = ${this.alias}.id`)
            .first();
        },
        async activeJobId(stmt) {
          stmt
            .from("test.jobs")
            .where("jobs.active", true)
            .whereRaw(`jobs.user_id = ${this.alias}.id`)
            .pluck("id");
        },
        async activeJobs(stmt) {
          stmt
            .from("test.jobs")
            .where("jobs.active", true)
            .whereRaw(`jobs.user_id = ${this.alias}.id`);
        },
      },
    });

    const jobs = new Table({
      schemaName: "test",
      tableName: "jobs",
    });

    await users.init(knex);
    await jobs.init(knex);
    users.linkTables([jobs]);
    jobs.linkTables([users]);

    queries = [];
    expect(await users.read(knex, { include: "activeJob" }, {}))
      .toMatchInlineSnapshot(`
      Object {
        "data": Array [
          Object {
            "_links": Object {
              "activeJob": "/test/users/1/activeJob",
              "activeJobId": "/test/users/1/activeJobId",
              "activeJobs": "/test/users/1/activeJobs",
              "jobs": "/test/jobs?userId=1",
            },
            "_type": "test/users",
            "_url": "/test/users/1",
            "activeJob": Object {
              "active": true,
              "id": 1,
              "userId": 1,
            },
            "id": 1,
          },
        ],
        "meta": Object {
          "_collection": "test/users",
          "_links": Object {
            "count": "/test/users/count?include=activeJob",
            "ids": "/test/users/ids?include=activeJob",
          },
          "_type": "collection",
          "_url": "/test/users?include=activeJob",
          "hasMore": false,
          "limit": 50,
          "page": 0,
        },
      }
    `);
    expect(queries).toMatchInlineSnapshot(`
      Array [
        "select users.id, (select row_to_json(i) from (select * from test.jobs where jobs.active = ? and jobs.user_id = users.id limit ?) as i) as active_job from test.users order by users.id asc limit ?",
      ]
    `);

    queries = [];
    expect(await users.read(knex, { include: "activeJobs" }, {}))
      .toMatchInlineSnapshot(`
      Object {
        "data": Array [
          Object {
            "_links": Object {
              "activeJob": "/test/users/1/activeJob",
              "activeJobId": "/test/users/1/activeJobId",
              "activeJobs": "/test/users/1/activeJobs",
              "jobs": "/test/jobs?userId=1",
            },
            "_type": "test/users",
            "_url": "/test/users/1",
            "activeJobs": Array [
              Object {
                "active": true,
                "id": 1,
                "userId": 1,
              },
            ],
            "id": 1,
          },
        ],
        "meta": Object {
          "_collection": "test/users",
          "_links": Object {
            "count": "/test/users/count?include=activeJobs",
            "ids": "/test/users/ids?include=activeJobs",
          },
          "_type": "collection",
          "_url": "/test/users?include=activeJobs",
          "hasMore": false,
          "limit": 50,
          "page": 0,
        },
      }
    `);
    expect(queries).toMatchInlineSnapshot(`
      Array [
        "select users.id, array(select row_to_json(i) from (select * from test.jobs where jobs.active = ? and jobs.user_id = users.id) as i) as active_jobs from test.users order by users.id asc limit ?",
      ]
    `);

    queries = [];
    expect(
      await users.read(
        knex,
        { include: ["activeJob", "activeJobs", "activeJobId"] },
        {}
      )
    ).toMatchInlineSnapshot(`
      Object {
        "data": Array [
          Object {
            "_links": Object {
              "activeJob": "/test/users/1/activeJob",
              "activeJobId": "/test/users/1/activeJobId",
              "activeJobs": "/test/users/1/activeJobs",
              "jobs": "/test/jobs?userId=1",
            },
            "_type": "test/users",
            "_url": "/test/users/1",
            "activeJob": Object {
              "active": true,
              "id": 1,
              "userId": 1,
            },
            "activeJobId": 1,
            "activeJobs": Array [
              Object {
                "active": true,
                "id": 1,
                "userId": 1,
              },
            ],
            "id": 1,
          },
        ],
        "meta": Object {
          "_collection": "test/users",
          "_links": Object {
            "count": "/test/users/count?include[]=activeJob&include[]=activeJobs&include[]=activeJobId",
            "ids": "/test/users/ids?include[]=activeJob&include[]=activeJobs&include[]=activeJobId",
          },
          "_type": "collection",
          "_url": "/test/users?include[]=activeJob&include[]=activeJobs&include[]=activeJobId",
          "hasMore": false,
          "limit": 50,
          "page": 0,
        },
      }
    `);
    expect(queries).toMatchInlineSnapshot(`
      Array [
        "select users.id, (select row_to_json(i) from (select * from test.jobs where jobs.active = ? and jobs.user_id = users.id limit ?) as i) as active_job, array(select row_to_json(i) from (select * from test.jobs where jobs.active = ? and jobs.user_id = users.id) as i) as active_jobs, (select id from test.jobs where jobs.active = ? and jobs.user_id = users.id) as active_job_id from test.users order by users.id asc limit ?",
      ]
    `);
  });

  it("supports getters", async () => {
    await knex.schema.withSchema("test").createTable("test", (t) => {
      t.bigIncrements("id").primary();
    });

    const [item] = await knex("test.test").insert({}).returning("*");

    const table = new Table({
      schemaName: "test",
      tableName: "test",
      getters: {
        async dynamic(_row, _context) {
          return 2 + 2;
        },
      },
    });

    await table.init(knex);

    expect(
      await table.read(knex, { include: "dynamic", id: item.id }, {}, false)
    ).toMatchInlineSnapshot(`
      Object {
        "_links": Object {
          "dynamic": "/test/test/1/dynamic",
        },
        "_type": "test/test",
        "_url": "/test/test/1?include[]=dynamic",
        "dynamic": 4,
        "id": 1,
      }
    `);
  });

  it("supports setters", async () => {
    await knex.schema.withSchema("test").createTable("test", (t) => {
      t.bigIncrements("id").primary();
    });

    let result: [any, any, any][] = [];
    const table = new Table({
      schemaName: "test",
      tableName: "test",
      setters: {
        async dynamic(_trx, value, row, context) {
          result.push([value, row, context]);
        },
      },
    });

    await table.init(knex);

    expect(await table.write(knex, { dynamic: { abc: 123 } }, { userId: 1 }))
      .toMatchInlineSnapshot(`
      Object {
        "changes": Array [
          Object {
            "mode": "insert",
            "row": Object {
              "id": 1,
            },
            "schemaName": "test",
            "tableName": "test",
          },
        ],
        "result": Object {
          "_links": Object {},
          "_type": "test/test",
          "_url": "/test/test/1",
          "id": 1,
        },
      }
    `);
    expect(result).toMatchInlineSnapshot(`
      Array [
        Array [
          Object {
            "abc": 123,
          },
          Object {
            "id": 1,
          },
          Object {
            "userId": 1,
          },
        ],
      ]
    `);

    result = [];
    expect(
      await table.write(knex, { id: 1, dynamic: { abc: 456 } }, { userId: 1 })
    ).toMatchInlineSnapshot(`
      Object {
        "changes": Array [
          Object {
            "mode": "update",
            "row": Object {
              "id": 1,
            },
            "schemaName": "test",
            "tableName": "test",
          },
        ],
        "result": Object {
          "_links": Object {},
          "_type": "test/test",
          "_url": "/test/test/1",
          "id": 1,
        },
      }
    `);
    expect(result).toMatchInlineSnapshot(`
      Array [
        Array [
          Object {
            "abc": 456,
          },
          Object {
            "id": 1,
          },
          Object {
            "userId": 1,
          },
        ],
      ]
    `);
  });

  it("supports id modifiers", async () => {
    await knex.schema.withSchema("test").createTable("users", (t) => {
      t.bigIncrements("id").primary();
    });

    const [user] = await knex("test.users").insert({}).returning("*");

    const table = new Table({
      schemaName: "test",
      tableName: "users",
      idModifiers: {
        async me(stmt, _context) {
          stmt.where("id", user.id);
        },
      },
    });

    await table.init(knex);

    queries = [];
    expect(await table.read(knex, { id: "me" }, {}, false))
      .toMatchInlineSnapshot(`
      Object {
        "_links": Object {},
        "_type": "test/users",
        "_url": "/test/users/1",
        "id": 1,
      }
    `);
    expect(queries).toMatchInlineSnapshot(`
      Array [
        "select users.id from test.users where id = ? limit ?",
      ]
    `);
  });

  it("supports query modifiers", async () => {
    await knex.schema.withSchema("test").createTable("jobs", (t) => {
      t.bigIncrements("id").primary();
      t.boolean("is_active").notNullable().defaultTo(false);
    });

    await knex("test.jobs").insert({}).returning("*");
    await knex("test.jobs").insert({ isActive: true }).returning("*");

    const table = new Table({
      schemaName: "test",
      tableName: "jobs",
      queryModifiers: {
        async active(value, stmt, _context) {
          stmt.where("isActive", Boolean(value));
        },
      },
    });

    await table.init(knex);

    queries = [];
    expect(await table.read(knex, { active: true }, {}, false))
      .toMatchInlineSnapshot(`
      Object {
        "_links": Object {},
        "_type": "test/jobs",
        "_url": "/test/jobs/2",
        "id": 2,
        "isActive": true,
      }
    `);
    expect(queries).toMatchInlineSnapshot(`
      Array [
        "select jobs.id, jobs.is_active from test.jobs where is_active = ? limit ?",
      ]
    `);

    queries = [];
    expect(await table.read(knex, { active: false }, {}, false))
      .toMatchInlineSnapshot(`
      Object {
        "_links": Object {},
        "_type": "test/jobs",
        "_url": "/test/jobs/1",
        "id": 1,
        "isActive": false,
      }
    `);
    expect(queries).toMatchInlineSnapshot(`
      Array [
        "select jobs.id, jobs.is_active from test.jobs where is_active = ? limit ?",
      ]
    `);
  });

  it("supports page pagination", async () => {
    await knex.schema.withSchema("test").createTable("jobs", (t) => {
      t.bigIncrements("id").primary();
      t.boolean("is_active").notNullable().defaultTo(false);
    });

    for (let i = 0; i < 100; i++) await knex("test.jobs").insert({});

    for (let i = 0; i < 100; i++)
      await knex("test.jobs").insert({ isActive: true });

    const table = new Table({
      schemaName: "test",
      tableName: "jobs",
    });

    await table.init(knex);

    queries = [];
    expect(await table.read(knex, { limit: 2 }, {})).toMatchInlineSnapshot(`
      Object {
        "data": Array [
          Object {
            "_links": Object {},
            "_type": "test/jobs",
            "_url": "/test/jobs/1",
            "id": 1,
            "isActive": false,
          },
          Object {
            "_links": Object {},
            "_type": "test/jobs",
            "_url": "/test/jobs/2",
            "id": 2,
            "isActive": false,
          },
        ],
        "meta": Object {
          "_collection": "test/jobs",
          "_links": Object {
            "count": "/test/jobs/count?limit=2",
            "ids": "/test/jobs/ids?limit=2",
            "nextPage": "/test/jobs?limit=2&cursor=eyJpZCI6MiwiaXNBY3RpdmUiOmZhbHNlfQ%3D%3D",
          },
          "_type": "collection",
          "_url": "/test/jobs?limit=2",
          "hasMore": true,
          "limit": 2,
          "page": 0,
        },
      }
    `);
    expect(queries).toMatchInlineSnapshot(`
      Array [
        "select jobs.id, jobs.is_active from test.jobs order by jobs.id asc limit ?",
      ]
    `);

    queries = [];
    expect(await table.read(knex, { limit: 2, page: 1 }, {}))
      .toMatchInlineSnapshot(`
      Object {
        "data": Array [
          Object {
            "_links": Object {},
            "_type": "test/jobs",
            "_url": "/test/jobs/3",
            "id": 3,
            "isActive": false,
          },
          Object {
            "_links": Object {},
            "_type": "test/jobs",
            "_url": "/test/jobs/4",
            "id": 4,
            "isActive": false,
          },
        ],
        "meta": Object {
          "_collection": "test/jobs",
          "_links": Object {
            "count": "/test/jobs/count?limit=2&page=1",
            "ids": "/test/jobs/ids?limit=2&page=1",
            "nextPage": "/test/jobs?limit=2&page=2",
            "previousPage": "/test/jobs?limit=2&page=0",
          },
          "_type": "collection",
          "_url": "/test/jobs?limit=2&page=1",
          "hasMore": true,
          "limit": 2,
          "page": 1,
        },
      }
    `);
    expect(queries).toMatchInlineSnapshot(`
      Array [
        "select jobs.id, jobs.is_active from test.jobs order by jobs.id asc limit ? offset ?",
      ]
    `);

    queries = [];
    expect(await table.read(knex, { limit: 2, page: 100 }, {}))
      .toMatchInlineSnapshot(`
      Object {
        "data": Array [],
        "meta": Object {
          "_collection": "test/jobs",
          "_links": Object {
            "count": "/test/jobs/count?limit=2&page=100",
            "ids": "/test/jobs/ids?limit=2&page=100",
            "previousPage": "/test/jobs?limit=2&page=99",
          },
          "_type": "collection",
          "_url": "/test/jobs?limit=2&page=100",
          "hasMore": false,
          "limit": 2,
          "page": 100,
        },
      }
    `);
    expect(queries).toMatchInlineSnapshot(`
      Array [
        "select jobs.id, jobs.is_active from test.jobs order by jobs.id asc limit ? offset ?",
      ]
    `);
  });
});

describe("with policies", () => {
  it("prevents reads outside of policy", async () => {
    type Context = {
      orgId: number;
    };

    await knex.schema.withSchema("test").createTable("orgs", (t) => {
      t.bigIncrements("id").primary();
    });

    await knex.schema.withSchema("test").createTable("users", (t) => {
      t.bigIncrements("id").primary();
      t.bigInteger("org_id")
        .references("id")
        .inTable("test.orgs")
        .notNullable();
    });

    await knex.schema.withSchema("test").createTable("posts", (t) => {
      t.bigIncrements("id").primary();
      t.bigInteger("org_id")
        .references("id")
        .inTable("test.orgs")
        .notNullable();
      t.bigInteger("user_id").references("id").inTable("test.users");
    });

    const users = new Table<Context>({
      schemaName: "test",
      tableName: "users",
      async policy(stmt, context) {
        stmt.where(`${this.alias}.orgId`, context.orgId);
      },
    });

    const posts = new Table<Context>({
      schemaName: "test",
      tableName: "posts",
      async policy(stmt, context) {
        stmt.where(`${this.alias}.orgId`, context.orgId);
      },
    });

    await users.init(knex);
    await posts.init(knex);
    users.linkTables([users, posts]);
    posts.linkTables([users, posts]);

    const [org1] = await knex("test.orgs").insert({}).returning("*");
    const [org2] = await knex("test.orgs").insert({}).returning("*");

    const [user1] = await knex("test.users")
      .insert({ orgId: org1.id })
      .returning("*");
    const [user2] = await knex("test.users")
      .insert({ orgId: org2.id })
      .returning("*");

    await knex("test.posts")
      .insert({ orgId: org1.id, userId: user1.id })
      .returning("*");

    await knex("test.posts")
      .insert({ orgId: org2.id, userId: user2.id })
      .returning("*");

    queries = [];
    expect(await users.read(knex, { include: "posts" }, { orgId: 1 }))
      .toMatchInlineSnapshot(`
      Object {
        "data": Array [
          Object {
            "_links": Object {
              "posts": "/test/posts?userId=1",
            },
            "_type": "test/users",
            "_url": "/test/users/1",
            "id": 1,
            "orgId": 1,
            "posts": Array [
              Object {
                "_links": Object {
                  "user": "/test/users/1",
                },
                "_type": "test/posts",
                "_url": "/test/posts/1",
                "id": 1,
                "orgId": 1,
                "userId": 1,
              },
            ],
          },
        ],
        "meta": Object {
          "_collection": "test/users",
          "_links": Object {
            "count": "/test/users/count?include=posts",
            "ids": "/test/users/ids?include=posts",
          },
          "_type": "collection",
          "_url": "/test/users?include=posts",
          "hasMore": false,
          "limit": 50,
          "page": 0,
        },
      }
    `);
    expect(queries).toMatchInlineSnapshot(`
      Array [
        "select users.id, users.org_id, array(select row_to_json(posts_sub_query) from (select posts.id, posts.org_id, posts.user_id from test.posts where posts.user_id = users.id and posts.org_id = ? limit ?) posts_sub_query) as posts from test.users where users.org_id = ? order by users.id asc limit ?",
      ]
    `);

    queries = [];
    expect(await posts.read(knex, { include: ["user"] }, { orgId: 1 }))
      .toMatchInlineSnapshot(`
      Object {
        "data": Array [
          Object {
            "_links": Object {
              "user": "/test/users/1",
            },
            "_type": "test/posts",
            "_url": "/test/posts/1",
            "id": 1,
            "orgId": 1,
            "user": Object {
              "_links": Object {
                "posts": "/test/posts?userId=1",
              },
              "_type": "test/users",
              "_url": "/test/users/1",
              "id": 1,
              "orgId": 1,
            },
            "userId": 1,
          },
        ],
        "meta": Object {
          "_collection": "test/posts",
          "_links": Object {
            "count": "/test/posts/count?include[]=user",
            "ids": "/test/posts/ids?include[]=user",
          },
          "_type": "collection",
          "_url": "/test/posts?include[]=user",
          "hasMore": false,
          "limit": 50,
          "page": 0,
        },
      }
    `);
    expect(queries).toMatchInlineSnapshot(`
      Array [
        "select posts.id, posts.org_id, posts.user_id, (select row_to_json(users_sub_query) from (select users.id, users.org_id from test.users where users.id = posts.user_id and users.org_id = ? limit ?) users_sub_query) as user from test.posts where posts.org_id = ? order by posts.id asc limit ?",
      ]
    `);
  });

  it("prevents writes outside of policy", async () => {
    type Context = {
      orgId: number;
    };

    await knex.schema.withSchema("test").createTable("orgs", (t) => {
      t.bigIncrements("id").primary();
    });

    await knex.schema.withSchema("test").createTable("users", (t) => {
      t.bigIncrements("id").primary();
      t.bigInteger("org_id")
        .references("id")
        .inTable("test.orgs")
        .notNullable();
    });

    await knex.schema.withSchema("test").createTable("posts", (t) => {
      t.bigIncrements("id").primary();
      t.bigInteger("org_id")
        .references("id")
        .inTable("test.orgs")
        .notNullable();
      t.bigInteger("user_id").references("id").inTable("test.users");
      t.text("body").notNullable().defaultTo("");
    });

    const users = new Table<Context>({
      schemaName: "test",
      tableName: "users",
      async policy(stmt, context) {
        stmt.where(`${this.alias}.orgId`, context.orgId);
      },
    });

    const posts = new Table<Context>({
      schemaName: "test",
      tableName: "posts",
      async policy(stmt, context) {
        stmt.where(`${this.alias}.orgId`, context.orgId);
      },
    });

    await users.init(knex);
    await posts.init(knex);
    users.linkTables([users, posts]);
    posts.linkTables([users, posts]);

    const [org1] = await knex("test.orgs").insert({}).returning("*");
    const [org2] = await knex("test.orgs").insert({}).returning("*");

    const [user1] = await knex("test.users")
      .insert({ orgId: org1.id })
      .returning("*");
    const [user2] = await knex("test.users")
      .insert({ orgId: org2.id })
      .returning("*");

    const [post1] = await knex("test.posts")
      .insert({ orgId: org1.id, userId: user1.id })
      .returning("*");
    await knex("test.posts")
      .insert({ orgId: org2.id, userId: user2.id })
      .returning("*");

    queries = [];
    expect(
      await posts
        .write(knex, { orgId: org1.id }, { orgId: org2.id })
        .catch((e: UnauthorizedError) => [e.statusCode, e.message])
    ).toMatchInlineSnapshot(`
      Array [
        401,
        "Unauthorized",
      ]
    `);
    expect(queries).toMatchInlineSnapshot(`
      Array [
        "insert into test.posts (org_id) values (?) returning *",
        "select posts.id, posts.org_id, posts.user_id, posts.body from test.posts where posts.org_id = ? and posts.id = ? limit ?",
      ]
    `);

    queries = [];
    expect(
      await posts
        .write(knex, { id: post1.id }, { orgId: org2.id })
        .catch((e: UnauthorizedError) => [e.statusCode, e.message])
    ).toMatchInlineSnapshot(`
      Array [
        401,
        "Unauthorized",
      ]
    `);
    expect(queries).toMatchInlineSnapshot(`
      Array [
        "select posts.id, posts.org_id, posts.user_id, posts.body from test.posts where posts.id = ? and posts.org_id = ? limit ?",
      ]
    `);

    queries = [];
    expect(
      await posts
        .write(knex, { id: post1.id, _delete: true }, { orgId: org2.id })
        .catch((e: UnauthorizedError) => [e.statusCode, e.message])
    ).toMatchInlineSnapshot(`
      Array [
        401,
        "Unauthorized",
      ]
    `);
    expect(queries).toMatchInlineSnapshot(`
      Array [
        "select posts.id, posts.org_id, posts.user_id, posts.body from test.posts where posts.org_id = ? and posts.id = ? limit ?",
      ]
    `);

    queries = [];
    expect(
      await posts
        .write(knex, { id: post1.id, orgId: org2.id }, { orgId: org1.id })
        .catch((e: UnauthorizedError) => [e.statusCode, e.message])
    ).toMatchInlineSnapshot(`
      Array [
        401,
        "Unauthorized",
      ]
    `);
    expect(queries).toMatchInlineSnapshot(`
      Array [
        "select posts.id, posts.org_id, posts.user_id, posts.body from test.posts where posts.id = ? and posts.org_id = ? limit ?",
        "select posts.id, posts.org_id, posts.user_id, posts.body from test.posts where posts.org_id = ? and posts.id = ? limit ?",
        "update test.posts set org_id = ? where posts.org_id = ? and posts.id = ?",
        "select posts.id, posts.org_id, posts.user_id, posts.body from test.posts where posts.org_id = ? and posts.id = ? limit ?",
      ]
    `);

    queries = [];
    expect(await posts.write(knex, { orgId: org1.id }, { orgId: org1.id }))
      .toMatchInlineSnapshot(`
      Object {
        "changes": Array [
          Object {
            "mode": "insert",
            "row": Object {
              "body": "",
              "id": 4,
              "orgId": 1,
              "userId": null,
            },
            "schemaName": "test",
            "tableName": "posts",
          },
        ],
        "result": Object {
          "_links": Object {},
          "_type": "test/posts",
          "_url": "/test/posts/4",
          "body": "",
          "id": 4,
          "orgId": 1,
          "userId": null,
        },
      }
    `);
    expect(queries).toMatchInlineSnapshot(`
      Array [
        "insert into test.posts (org_id) values (?) returning *",
        "select posts.id, posts.org_id, posts.user_id, posts.body from test.posts where posts.org_id = ? and posts.id = ? limit ?",
      ]
    `);

    queries = [];
    expect(await posts.write(knex, { id: post1.id }, { orgId: org1.id }))
      .toMatchInlineSnapshot(`
      Object {
        "changes": Array [],
        "result": Object {
          "_links": Object {
            "user": "/test/users/1",
          },
          "_type": "test/posts",
          "_url": "/test/posts/1",
          "body": "",
          "id": 1,
          "orgId": 1,
          "userId": 1,
        },
      }
    `);
    expect(queries).toMatchInlineSnapshot(`
      Array [
        "select posts.id, posts.org_id, posts.user_id, posts.body from test.posts where posts.id = ? and posts.org_id = ? limit ?",
        "select posts.id, posts.org_id, posts.user_id, posts.body from test.posts where posts.org_id = ? and posts.id = ? limit ?",
      ]
    `);

    queries = [];
    expect(
      await posts.write(
        knex,
        { id: post1.id, body: "Body" },
        { orgId: org1.id }
      )
    ).toMatchInlineSnapshot(`
      Object {
        "changes": Array [
          Object {
            "mode": "update",
            "row": Object {
              "body": "Body",
              "id": 1,
              "orgId": 1,
              "userId": 1,
            },
            "schemaName": "test",
            "tableName": "posts",
          },
        ],
        "result": Object {
          "_links": Object {
            "user": "/test/users/1",
          },
          "_type": "test/posts",
          "_url": "/test/posts/1",
          "body": "Body",
          "id": 1,
          "orgId": 1,
          "userId": 1,
        },
      }
    `);
    expect(queries).toMatchInlineSnapshot(`
      Array [
        "select posts.id, posts.org_id, posts.user_id, posts.body from test.posts where posts.id = ? and posts.org_id = ? limit ?",
        "select posts.id, posts.org_id, posts.user_id, posts.body from test.posts where posts.org_id = ? and posts.id = ? limit ?",
        "update test.posts set body = ? where posts.org_id = ? and posts.id = ?",
        "select posts.id, posts.org_id, posts.user_id, posts.body from test.posts where posts.org_id = ? and posts.id = ? limit ?",
      ]
    `);

    queries = [];
    expect(
      await posts
        .write(knex, { id: post1.id, _delete: true }, { orgId: org1.id })
        .catch((e: UnauthorizedError) => [e.statusCode, e.message])
    ).toMatchInlineSnapshot(`
      Object {
        "changes": Array [
          Object {
            "mode": "delete",
            "row": Object {
              "body": "Body",
              "id": 1,
              "orgId": 1,
              "userId": 1,
            },
            "schemaName": "test",
            "tableName": "posts",
          },
        ],
        "result": null,
      }
    `);
    expect(queries).toMatchInlineSnapshot(`
      Array [
        "select posts.id, posts.org_id, posts.user_id, posts.body from test.posts where posts.org_id = ? and posts.id = ? limit ?",
        "delete from test.posts where posts.id = ?",
      ]
    `);
  });

  it("counts", async () => {
    await knex.schema.withSchema("test").createTable("users", (t) => {
      t.bigIncrements("id").primary();
    });
    await knex.schema.withSchema("test").createTable("test", (t) => {
      t.bigIncrements("id").primary();
      t.bigInteger("userId")
        .references("id")
        .inTable("test.users")
        .notNullable();
    });

    const [user1] = await knex("test.users").insert({}).returning("*");
    const [user2] = await knex("test.users").insert({}).returning("*");

    for (let i = 0; i < 100; i++)
      await knex("test.test").insert({ userId: user1.id });

    await knex("test.test")
      .update({ userId: user2.id })
      .whereIn("id", knex("test.test").limit(50).select("id"));

    type Context = {
      userId: number;
    };

    const table = new Table<Context>({
      schemaName: "test",
      tableName: "test",
      async policy(stmt, context) {
        stmt.where("userId", context.userId);
      },
    });

    await table.init(knex);

    queries = [];
    expect(
      await table.count(knex, {}, { userId: user1.id })
    ).toMatchInlineSnapshot(`50`);
    expect(queries).toMatchInlineSnapshot(`
      Array [
        "select count(distinct test.id) from test.test where user_id = ?",
      ]
    `);

    queries = [];
    expect(
      await table.count(knex, {}, { userId: user2.id })
    ).toMatchInlineSnapshot(`50`);
    expect(queries).toMatchInlineSnapshot(`
      Array [
        "select count(distinct test.id) from test.test where user_id = ?",
      ]
    `);
  });

  it("gets ids", async () => {
    await knex.schema.withSchema("test").createTable("users", (t) => {
      t.bigIncrements("id").primary();
    });
    await knex.schema.withSchema("test").createTable("test", (t) => {
      t.bigIncrements("id").primary();
      t.bigInteger("userId")
        .references("id")
        .inTable("test.users")
        .notNullable();
    });

    const [user1] = await knex("test.users").insert({}).returning("*");
    const [user2] = await knex("test.users").insert({}).returning("*");

    for (let i = 0; i < 100; i++)
      await knex("test.test").insert({ userId: user1.id });

    await knex("test.test")
      .update({ userId: user2.id })
      .whereIn("id", knex("test.test").limit(50).select("id"));

    type Context = {
      userId: number;
    };

    const table = new Table<Context>({
      schemaName: "test",
      tableName: "test",
      async policy(stmt, context) {
        stmt.where("userId", context.userId);
      },
    });

    await table.init(knex);

    queries = [];
    expect(
      (await table.ids(knex, {}, { userId: user1.id })).data.length
    ).toMatchInlineSnapshot(`50`);
    expect(queries).toMatchInlineSnapshot(`
      Array [
        "select test.id from test.test where user_id = ? limit ?",
      ]
    `);

    queries = [];
    expect(
      (await table.ids(knex, {}, { userId: user2.id })).data.length
    ).toMatchInlineSnapshot(`50`);
    expect(queries).toMatchInlineSnapshot(`
      Array [
        "select test.id from test.test where user_id = ? limit ?",
      ]
    `);
  });
});

describe("multitenancy", () => {
  it("requires tenant id on read", async () => {
    await knex.schema.withSchema("test").createTable("orgs", (t) => {
      t.bigIncrements("id").primary();
    });

    await knex.schema.withSchema("test").createTable("items", (t) => {
      t.bigIncrements("id").primary();
      t.bigInteger("orgId").references("id").inTable("test.orgs").notNullable();
    });

    const [org] = await knex("test.orgs").insert({}).returning("*");

    await knex("test.items").insert({ orgId: org.id });

    const items = new Table({
      schemaName: "test",
      tableName: "items",
      tenantIdColumnName: "orgId",
    });

    const orgs = new Table({
      schemaName: "test",
      tableName: "orgs",
      tenantIdColumnName: "id",
    });

    await items.init(knex);
    await orgs.init(knex);
    items.linkTables([orgs, items]);
    orgs.linkTables([items, orgs]);

    expect(await items.read(knex, {}, {}).catch((e: BadRequestError) => e.body))
      .toMatchInlineSnapshot(`
      Object {
        "error": "orgId is required",
      }
    `);

    expect(await items.read(knex, { orgId: org.id }, {}))
      .toMatchInlineSnapshot(`
      Object {
        "data": Array [
          Object {
            "_links": Object {
              "org": "/test/orgs/1?id=1",
            },
            "_type": "test/items",
            "_url": "/test/items/1?orgId=1",
            "id": 1,
            "orgId": 1,
          },
        ],
        "meta": Object {
          "_collection": "test/items",
          "_links": Object {
            "count": "/test/items/count?orgId=1",
            "ids": "/test/items/ids?orgId=1",
          },
          "_type": "collection",
          "_url": "/test/items?orgId=1",
          "hasMore": false,
          "limit": 50,
          "page": 0,
        },
      }
    `);

    expect(await items.ids(knex, {}, {}).catch((e: BadRequestError) => e.body))
      .toMatchInlineSnapshot(`
      Object {
        "error": "orgId is required",
      }
    `);

    expect(await items.ids(knex, { orgId: org.id }, {})).toMatchInlineSnapshot(`
      Object {
        "data": Array [
          1,
        ],
        "meta": Object {
          "_links": Object {},
          "_url": "/test/items/ids?orgId=1",
          "hasMore": false,
          "limit": 1000,
          "page": 0,
        },
      }
    `);

    expect(
      await items.count(knex, {}, {}).catch((e: BadRequestError) => e.body)
    ).toMatchInlineSnapshot(`
      Object {
        "error": "orgId is required",
      }
    `);

    expect(
      await items.count(knex, { orgId: org.id }, {})
    ).toMatchInlineSnapshot(`1`);

    expect(await items.read(knex, { orgId: org.id, include: ["org"] }, {}))
      .toMatchInlineSnapshot(`
      Object {
        "data": Array [
          Object {
            "_links": Object {
              "org": "/test/orgs/1?id=1",
            },
            "_type": "test/items",
            "_url": "/test/items/1?orgId=1",
            "id": 1,
            "org": Object {
              "_links": Object {
                "items": "/test/items?orgId=1",
              },
              "_type": "test/orgs",
              "_url": "/test/orgs/1",
              "id": 1,
            },
            "orgId": 1,
          },
        ],
        "meta": Object {
          "_collection": "test/items",
          "_links": Object {
            "count": "/test/items/count?orgId=1&include[]=org",
            "ids": "/test/items/ids?orgId=1&include[]=org",
          },
          "_type": "collection",
          "_url": "/test/items?orgId=1&include[]=org",
          "hasMore": false,
          "limit": 50,
          "page": 0,
        },
      }
    `);
  });

  it("requires tenant id on write", async () => {
    await knex.schema.withSchema("test").createTable("orgs", (t) => {
      t.bigIncrements("id").primary();
    });

    await knex.schema.withSchema("test").createTable("items", (t) => {
      t.bigIncrements("id").primary();
      t.bigInteger("orgId").references("id").inTable("test.orgs").notNullable();
      t.text("body").notNullable().defaultTo("");
    });

    const [org] = await knex("test.orgs").insert({}).returning("*");

    const [item] = await knex("test.items")
      .insert({ orgId: org.id })
      .returning("*");

    const items = new Table({
      schemaName: "test",
      tableName: "items",
      tenantIdColumnName: "orgId",
    });

    await items.init(knex);

    expect(
      await items.write(knex, {}, {}).catch((e: BadRequestError) => e.body)
    ).toMatchInlineSnapshot(`
      Object {
        "errors": Object {
          "orgId": "is required",
        },
      }
    `);

    expect(
      await items
        .write(knex, { id: item.id }, {})
        .catch((e: BadRequestError) => e.body)
    ).toMatchInlineSnapshot(`
      Object {
        "errors": Object {
          "orgId": "is required",
        },
      }
    `);

    expect(
      await items
        .write(knex, { id: item.id, _delete: true }, {})
        .catch((e: BadRequestError) => e.body)
    ).toMatchInlineSnapshot(`
      Object {
        "errors": Object {
          "orgId": "is required",
        },
      }
    `);

    expect(await items.write(knex, { orgId: org.id }, {}))
      .toMatchInlineSnapshot(`
      Object {
        "changes": Array [
          Object {
            "mode": "insert",
            "row": Object {
              "body": "",
              "id": 2,
              "orgId": 1,
            },
            "schemaName": "test",
            "tableName": "items",
          },
        ],
        "result": Object {
          "_links": Object {},
          "_type": "test/items",
          "_url": "/test/items/2?orgId=1",
          "body": "",
          "id": 2,
          "orgId": 1,
        },
      }
    `);

    expect(
      await items.write(knex, { id: item.id, orgId: org.id, body: "body" }, {})
    ).toMatchInlineSnapshot(`
      Object {
        "changes": Array [
          Object {
            "mode": "update",
            "row": Object {
              "body": "body",
              "id": 1,
              "orgId": 1,
            },
            "schemaName": "test",
            "tableName": "items",
          },
        ],
        "result": Object {
          "_links": Object {},
          "_type": "test/items",
          "_url": "/test/items/1?orgId=1",
          "body": "body",
          "id": 1,
          "orgId": 1,
        },
      }
    `);

    expect(
      await items.write(knex, { id: item.id, orgId: org.id, _delete: true }, {})
    ).toMatchInlineSnapshot(`
      Object {
        "changes": Array [
          Object {
            "mode": "delete",
            "row": Object {
              "body": "body",
              "id": 1,
              "orgId": 1,
            },
            "schemaName": "test",
            "tableName": "items",
          },
        ],
        "result": null,
      }
    `);
  });

  it("forwards query param to getters", async () => {
    await knex.schema.withSchema("test").createTable("orgs", (t) => {
      t.bigIncrements("id").primary();
    });

    await knex.schema.withSchema("test").createTable("items", (t) => {
      t.bigIncrements("id").primary();
      t.bigInteger("orgId").references("id").inTable("test.orgs").notNullable();
    });

    const [org] = await knex("test.orgs").insert({}).returning("*");

    await knex("test.items").insert({ orgId: org.id });

    const items = new Table({
      schemaName: "test",
      tableName: "items",
      tenantIdColumnName: "orgId",
      getters: {
        async getter() {
          return "yo";
        },
      },
    });

    const orgs = new Table({
      schemaName: "test",
      tableName: "orgs",
      tenantIdColumnName: "id",
    });

    await items.init(knex);
    await orgs.init(knex);
    items.linkTables([orgs, items]);
    orgs.linkTables([items, orgs]);

    expect(await items.read(knex, { orgId: org.id }, {}))
      .toMatchInlineSnapshot(`
      Object {
        "data": Array [
          Object {
            "_links": Object {
              "getter": "/test/items/1/getter?orgId=1",
              "org": "/test/orgs/1?id=1",
            },
            "_type": "test/items",
            "_url": "/test/items/1?orgId=1",
            "id": 1,
            "orgId": 1,
          },
        ],
        "meta": Object {
          "_collection": "test/items",
          "_links": Object {
            "count": "/test/items/count?orgId=1",
            "ids": "/test/items/ids?orgId=1",
          },
          "_type": "collection",
          "_url": "/test/items?orgId=1",
          "hasMore": false,
          "limit": 50,
          "page": 0,
        },
      }
    `);
  });

  it("validates compound unique keys with tenant id", async () => {
    await knex.schema.withSchema("test").createTable("orgs", (t) => {
      t.bigIncrements("id").primary();
    });

    await knex.schema.withSchema("test").createTable("test", (t) => {
      t.bigIncrements("id").primary();
      t.bigInteger("orgId").references("id").inTable("test.orgs").notNullable();
      t.text("username").notNullable();
      t.unique(["orgId", "username"]);
    });

    const orgs = new Table({
      schemaName: "test",
      tableName: "orgs",
    });
    const table = new Table({
      schemaName: "test",
      tableName: "test",
      tenantIdColumnName: "orgId",
    });

    await orgs.init(knex);
    await table.init(knex);

    orgs.linkTables([table]);
    table.linkTables([orgs]);

    const [org] = await knex("test.orgs").insert({}).returning("*");

    await knex("test.test").truncate();
    queries = [];
    expect(await table.write(knex, { username: "abc", orgId: org.id }, {}))
      .toMatchInlineSnapshot(`
      Object {
        "changes": Array [
          Object {
            "mode": "insert",
            "row": Object {
              "id": 1,
              "orgId": 1,
              "username": "abc",
            },
            "schemaName": "test",
            "tableName": "test",
          },
        ],
        "result": Object {
          "_links": Object {
            "org": "/test/orgs/1",
          },
          "_type": "test/test",
          "_url": "/test/test/1?orgId=1",
          "id": 1,
          "orgId": 1,
          "username": "abc",
        },
      }
    `);
    expect(queries).toMatchInlineSnapshot(`
      Array [
        "select test.id, test.org_id, test.username from test.test where test.org_id = ? and test.username = ? limit ?",
        "select test.id, test.org_id, test.username from test.test where test.org_id = ? and test.username = ? limit ?",
        "insert into test.test (org_id, username) values (?, ?) returning *",
        "select test.id, test.org_id, test.username from test.test where test.id = ? and test.org_id = ? limit ?",
      ]
    `);

    queries = [];
    expect(
      await table
        .write(knex, { id: "1", username: "abc", orgId: org.id }, {})
        .catch((e: BadRequestError) => e.body)
    ).toMatchInlineSnapshot(`
      Object {
        "changes": Array [],
        "result": Object {
          "_links": Object {
            "org": "/test/orgs/1",
          },
          "_type": "test/test",
          "_url": "/test/test/1?orgId=1",
          "id": 1,
          "orgId": 1,
          "username": "abc",
        },
      }
    `);
    expect(queries).toMatchInlineSnapshot(`
      Array [
        "select test.id, test.org_id, test.username from test.test where test.id = ? and test.org_id = ? limit ?",
        "select test.id, test.org_id, test.username from test.test where not (test.id = ? and test.org_id = ?) and test.org_id = ? and test.username = ? limit ?",
        "select test.id, test.org_id, test.username from test.test where not (test.id = ? and test.org_id = ?) and test.org_id = ? and test.username = ? limit ?",
        "select test.id, test.org_id, test.username from test.test where test.id = ? and test.org_id = ? limit ?",
      ]
    `);
  });
});

describe("paranoid", () => {
  it("errors when a table does not have a deletedAt column", async () => {
    await knex.schema.withSchema("test").createTable("items", (t) => {
      t.bigIncrements("id").primary();
    });

    const items = new Table({
      schemaName: "test",
      tableName: "items",
      paranoid: true,
    });

    await expect(items.init(knex)).rejects.toThrow();
  });

  it("works with paranoid tables", async () => {
    await knex.schema.withSchema("test").createTable("items", (t) => {
      t.bigIncrements("id").primary();
      t.timestamp("deleted_at", { useTz: true });
    });
    await knex.schema.withSchema("test").createTable("subitems", (t) => {
      t.bigIncrements("id").primary();
      t.timestamp("deleted_at", { useTz: true });
      t.bigInteger("item_id")
        .references("id")
        .inTable("test.items")
        .notNullable();
    });
    await knex.schema.withSchema("test").createTable("subsubitems", (t) => {
      t.bigIncrements("id").primary();
      t.bigInteger("subitem_id")
        .references("id")
        .inTable("test.subitems")
        .notNullable();
    });

    const items = new Table({
      schemaName: "test",
      tableName: "items",
      paranoid: true,
    });

    const subitems = new Table({
      schemaName: "test",
      tableName: "subitems",
      paranoid: true,
    });

    const subsubitems = new Table({
      schemaName: "test",
      tableName: "subsubitems",
    });

    await items.init(knex);
    await subitems.init(knex);
    await subsubitems.init(knex);
    items.linkTables([subitems, subsubitems]);
    subitems.linkTables([items, subsubitems]);

    expect(await items.write(knex, {}, {})).toMatchInlineSnapshot(`
      Object {
        "changes": Array [
          Object {
            "mode": "insert",
            "row": Object {
              "deletedAt": null,
              "id": 1,
            },
            "schemaName": "test",
            "tableName": "items",
          },
        ],
        "result": Object {
          "_links": Object {
            "subitems": "/test/subitems?itemId=1",
          },
          "_type": "test/items",
          "_url": "/test/items/1",
          "deletedAt": null,
          "id": 1,
        },
      }
    `);

    const [subitem] = await knex("test.subitems")
      .insert({ itemId: 1 })
      .returning("*");
    await knex("test.subitems").insert({ itemId: 1 });
    await knex("test.subsubitems").insert({ subitemId: subitem.id });

    expect(await items.write(knex, { id: 1, _delete: true }, {}))
      .toMatchInlineSnapshot(`
      Object {
        "changes": Array [
          Object {
            "mode": "delete",
            "row": Object {
              "deletedAt": null,
              "id": 1,
            },
            "schemaName": "test",
            "tableName": "items",
          },
          Object {
            "mode": "delete",
            "row": Object {
              "deletedAt": null,
              "id": 1,
              "itemId": 1,
            },
            "schemaName": "test",
            "tableName": "subitems",
          },
          Object {
            "mode": "delete",
            "row": Object {
              "deletedAt": null,
              "id": 2,
              "itemId": 1,
            },
            "schemaName": "test",
            "tableName": "subitems",
          },
        ],
        "result": null,
      }
    `);

    expect(await items.read(knex, { id: 1 }, {})).toMatchInlineSnapshot(`
      Object {
        "data": Array [],
        "meta": Object {
          "_collection": "test/items",
          "_links": Object {
            "count": "/test/items/count?id=1&withDeleted=false",
            "ids": "/test/items/ids?id=1&withDeleted=false",
          },
          "_type": "collection",
          "_url": "/test/items?id=1&withDeleted=false",
          "hasMore": false,
          "limit": 50,
          "page": 0,
        },
      }
    `);

    expect((await items.read(knex, { id: 1 }, {}, false)).deletedAt).not.toBe(
      null
    );

    expect(await items.read(knex, { withDeleted: true }, {}))
      .toMatchInlineSnapshot(`
      Object {
        "data": Array [
          Object {
            "_links": Object {
              "subitems": "/test/subitems?itemId=1",
            },
            "_type": "test/items",
            "_url": "/test/items/1",
            "deletedAt": 2021-03-20T01:43:23.037Z,
            "id": 1,
          },
        ],
        "meta": Object {
          "_collection": "test/items",
          "_links": Object {
            "count": "/test/items/count?withDeleted=true",
            "ids": "/test/items/ids?withDeleted=true",
          },
          "_type": "collection",
          "_url": "/test/items?withDeleted=true",
          "hasMore": false,
          "limit": 50,
          "page": 0,
        },
      }
    `);
  });

  it("cascades even with tenant ids", async () => {
    await knex.schema.withSchema("test").createTable("orgs", (t) => {
      t.bigIncrements("id").primary();
      t.timestamp("deleted_at", { useTz: true });
    });

    await knex.schema.withSchema("test").createTable("items", (t) => {
      t.bigIncrements("id").primary();
      t.bigInteger("orgId").references("id").inTable("test.orgs").notNullable();
      t.timestamp("deleted_at", { useTz: true });
    });

    await knex.schema.withSchema("test").createTable("subitems", (t) => {
      t.bigIncrements("id").primary();
      t.bigInteger("orgId").references("id").inTable("test.orgs").notNullable();
      t.bigInteger("itemId")
        .references("id")
        .inTable("test.items")
        .notNullable();
      t.timestamp("deleted_at", { useTz: true });
    });

    const [org] = await knex("test.orgs").insert({}).returning("*");

    const [item] = await knex("test.items")
      .insert({ orgId: org.id })
      .returning("*");

    await knex("test.subitems")
      .insert({ orgId: org.id, itemId: item.id })
      .returning("*");

    const items = new Table({
      schemaName: "test",
      tableName: "items",
      tenantIdColumnName: "orgId",
      paranoid: true,
    });

    const subitems = new Table({
      schemaName: "test",
      tableName: "subitems",
      tenantIdColumnName: "orgId",
      paranoid: true,
    });

    await items.init(knex);
    await subitems.init(knex);
    items.linkTables([subitems]);
    subitems.linkTables([items]);

    queries = [];
    expect(
      await items.write(knex, { id: item.id, orgId: org.id, _delete: true }, {})
    ).toMatchInlineSnapshot(`
      Object {
        "changes": Array [
          Object {
            "mode": "delete",
            "row": Object {
              "deletedAt": null,
              "id": 1,
              "orgId": 1,
            },
            "schemaName": "test",
            "tableName": "items",
          },
          Object {
            "mode": "delete",
            "row": Object {
              "deletedAt": null,
              "id": 1,
              "itemId": 1,
              "orgId": 1,
            },
            "schemaName": "test",
            "tableName": "subitems",
          },
        ],
        "result": null,
      }
    `);
    expect(queries).toMatchInlineSnapshot(`
      Array [
        "select items.id, items.org_id, items.deleted_at from test.items where items.org_id = ? and items.id = ? limit ?",
        "update test.items set deleted_at = ? where items.id = ? and items.org_id = ?",
        "select subitems.id from test.subitems where subitems.item_id = ? and subitems.org_id = ?",
        "select subitems.id, subitems.org_id, subitems.item_id, subitems.deleted_at from test.subitems where subitems.org_id = ? and subitems.id = ? limit ?",
        "update test.subitems set deleted_at = ? where subitems.id = ? and subitems.org_id = ?",
      ]
    `);
  });
});

describe("hidden columns", () => {
  it("does not read hidden columns", async () => {
    await knex.schema.withSchema("test").createTable("items", (t) => {
      t.bigIncrements("id").primary();
      t.text("hidden").notNullable().defaultTo("initial");
    });

    await knex("test.items").insert({
      hidden: "secret",
    });

    const items = new Table({
      schemaName: "test",
      tableName: "items",
      hiddenColumns: ["hidden"],
    });

    await items.init(knex);

    expect(await items.read(knex, {}, {})).toMatchInlineSnapshot(`
      Object {
        "data": Array [
          Object {
            "_links": Object {},
            "_type": "test/items",
            "_url": "/test/items/1",
            "id": 1,
          },
        ],
        "meta": Object {
          "_collection": "test/items",
          "_links": Object {
            "count": "/test/items/count",
            "ids": "/test/items/ids",
          },
          "_type": "collection",
          "_url": "/test/items",
          "hasMore": false,
          "limit": 50,
          "page": 0,
        },
      }
    `);
  });
  it("does not write hidden columns", async () => {
    await knex.schema.withSchema("test").createTable("items", (t) => {
      t.bigIncrements("id").primary();
      t.text("hidden").notNullable().defaultTo("initial");
    });

    const items = new Table({
      schemaName: "test",
      tableName: "items",
      hiddenColumns: ["hidden"],
    });

    await items.init(knex);

    expect(await items.write(knex, { hidden: "value" }, {}))
      .toMatchInlineSnapshot(`
      Object {
        "changes": Array [
          Object {
            "mode": "insert",
            "row": Object {
              "hidden": "initial",
              "id": 1,
            },
            "schemaName": "test",
            "tableName": "items",
          },
        ],
        "result": Object {
          "_links": Object {},
          "_type": "test/items",
          "_url": "/test/items/1",
          "id": 1,
        },
      }
    `);

    expect(await knex("test.items")).toMatchInlineSnapshot(`
      Array [
        Object {
          "hidden": "initial",
          "id": 1,
        },
      ]
    `);
  });
});

describe("uuid columns", () => {
  const uuid = () => "a8374dd3-0aa0-4ada-8c98-b7ade46900b8";
  it("reads uuids", async () => {
    await knex.schema.withSchema("test").createTable("items", (t) => {
      t.uuid("id").primary();
    });

    await knex("test.items").insert({ id: uuid() });

    const items = new Table({
      schemaName: "test",
      tableName: "items",
      idGenerator: uuid,
    });

    await items.init(knex);

    expect(await items.read(knex, {}, {})).toMatchInlineSnapshot(`
      Object {
        "data": Array [
          Object {
            "_links": Object {},
            "_type": "test/items",
            "_url": "/test/items/a8374dd3-0aa0-4ada-8c98-b7ade46900b8",
            "id": "a8374dd3-0aa0-4ada-8c98-b7ade46900b8",
          },
        ],
        "meta": Object {
          "_collection": "test/items",
          "_links": Object {
            "count": "/test/items/count",
            "ids": "/test/items/ids",
          },
          "_type": "collection",
          "_url": "/test/items",
          "hasMore": false,
          "limit": 50,
          "page": 0,
        },
      }
    `);
  });

  it("writes uuid", async () => {
    await knex.schema.withSchema("test").createTable("items", (t) => {
      t.uuid("id").primary();
    });

    const items = new Table({
      schemaName: "test",
      tableName: "items",
      idGenerator: uuid,
    });

    await items.init(knex);

    expect(await items.write(knex, {}, {})).toMatchInlineSnapshot(`
      Object {
        "changes": Array [
          Object {
            "mode": "insert",
            "row": Object {
              "id": "a8374dd3-0aa0-4ada-8c98-b7ade46900b8",
            },
            "schemaName": "test",
            "tableName": "items",
          },
        ],
        "result": Object {
          "_links": Object {},
          "_type": "test/items",
          "_url": "/test/items/a8374dd3-0aa0-4ada-8c98-b7ade46900b8",
          "id": "a8374dd3-0aa0-4ada-8c98-b7ade46900b8",
        },
      }
    `);

    expect(await knex("test.items")).toMatchInlineSnapshot(`
      Array [
        Object {
          "id": "a8374dd3-0aa0-4ada-8c98-b7ade46900b8",
        },
      ]
    `);
  });

  it("writes uuid relations", async () => {
    const uuids = [
      "95489980-03fd-4ffd-88b9-fb281aa4465a",
      "bed5cf57-1fd4-49f4-adce-1d9056420ca7",
      "763ca006-2c84-463a-904c-ab6630497148",
      "aea130e2-d027-485d-ba9d-f0d29c6311ba",
      "ea0824b5-4856-47c7-b541-31b1a00ce1a1",
      "bedaa8d1-20d2-4f09-adeb-d67ab0523af5",
      "cf688dba-747b-4fbe-8a02-ff8730e2a7c9",
      "3872e801-bf4c-4eb5-b4ab-c70cd9cd03d3",
      "0ae89559-c579-4d1a-8382-0a44693c78d2",
      "96435a51-7af8-4d08-94f3-892a99abd8cd",
    ];

    const uuid = () => uuids.pop();

    await knex.schema.withSchema("test").createTable("items", (t) => {
      t.uuid("id").primary();
    });

    await knex.schema.withSchema("test").createTable("subitems", (t) => {
      t.uuid("id").primary();
      t.uuid("parent_id").references("id").inTable("test.items").notNullable();
    });

    const items = new Table({
      schemaName: "test",
      tableName: "items",
      idGenerator: uuid,
    });

    const subitems = new Table({
      schemaName: "test",
      tableName: "subitems",
      idGenerator: uuid,
    });

    await items.init(knex);
    await subitems.init(knex);

    subitems.linkTables([items]);
    items.linkTables([subitems]);

    queries = [];
    expect(
      await items.write(
        knex,
        {
          subitems: [{}, {}],
        },
        {}
      )
    ).toMatchInlineSnapshot(`
      Object {
        "changes": Array [
          Object {
            "mode": "insert",
            "row": Object {
              "id": "96435a51-7af8-4d08-94f3-892a99abd8cd",
            },
            "schemaName": "test",
            "tableName": "items",
          },
          Object {
            "mode": "insert",
            "row": Object {
              "id": "0ae89559-c579-4d1a-8382-0a44693c78d2",
              "parentId": "96435a51-7af8-4d08-94f3-892a99abd8cd",
            },
            "schemaName": "test",
            "tableName": "subitems",
          },
          Object {
            "mode": "insert",
            "row": Object {
              "id": "3872e801-bf4c-4eb5-b4ab-c70cd9cd03d3",
              "parentId": "96435a51-7af8-4d08-94f3-892a99abd8cd",
            },
            "schemaName": "test",
            "tableName": "subitems",
          },
        ],
        "result": Object {
          "_links": Object {
            "subitems": "/test/subitems?parentId=96435a51-7af8-4d08-94f3-892a99abd8cd",
          },
          "_type": "test/items",
          "_url": "/test/items/96435a51-7af8-4d08-94f3-892a99abd8cd",
          "id": "96435a51-7af8-4d08-94f3-892a99abd8cd",
          "subitems": Array [
            Object {
              "_links": Object {
                "parent": "/test/items/96435a51-7af8-4d08-94f3-892a99abd8cd",
              },
              "_type": "test/subitems",
              "_url": "/test/subitems/0ae89559-c579-4d1a-8382-0a44693c78d2",
              "id": "0ae89559-c579-4d1a-8382-0a44693c78d2",
              "parentId": "96435a51-7af8-4d08-94f3-892a99abd8cd",
            },
            Object {
              "_links": Object {
                "parent": "/test/items/96435a51-7af8-4d08-94f3-892a99abd8cd",
              },
              "_type": "test/subitems",
              "_url": "/test/subitems/3872e801-bf4c-4eb5-b4ab-c70cd9cd03d3",
              "id": "3872e801-bf4c-4eb5-b4ab-c70cd9cd03d3",
              "parentId": "96435a51-7af8-4d08-94f3-892a99abd8cd",
            },
          ],
        },
      }
    `);
    expect(queries).toMatchInlineSnapshot(`
      Array [
        "insert into test.items (id) values (?) returning *",
        "select items.id from test.items where items.id = ? limit ?",
        "insert into test.subitems (id, parent_id) values (?, ?) returning *",
        "select subitems.id, subitems.parent_id from test.subitems where subitems.id = ? limit ?",
        "insert into test.subitems (id, parent_id) values (?, ?) returning *",
        "select subitems.id, subitems.parent_id from test.subitems where subitems.id = ? limit ?",
      ]
    `);

    queries = [];
    expect(
      await subitems.write(
        knex,
        {
          parent: {},
        },
        {}
      )
    ).toMatchInlineSnapshot(`
      Object {
        "changes": Array [
          Object {
            "mode": "insert",
            "row": Object {
              "id": "cf688dba-747b-4fbe-8a02-ff8730e2a7c9",
            },
            "schemaName": "test",
            "tableName": "items",
          },
          Object {
            "mode": "insert",
            "row": Object {
              "id": "bedaa8d1-20d2-4f09-adeb-d67ab0523af5",
              "parentId": "cf688dba-747b-4fbe-8a02-ff8730e2a7c9",
            },
            "schemaName": "test",
            "tableName": "subitems",
          },
        ],
        "result": Object {
          "_links": Object {
            "parent": "/test/items/cf688dba-747b-4fbe-8a02-ff8730e2a7c9",
          },
          "_type": "test/subitems",
          "_url": "/test/subitems/bedaa8d1-20d2-4f09-adeb-d67ab0523af5",
          "id": "bedaa8d1-20d2-4f09-adeb-d67ab0523af5",
          "parent": Object {
            "_links": Object {
              "subitems": "/test/subitems?parentId=cf688dba-747b-4fbe-8a02-ff8730e2a7c9",
            },
            "_type": "test/items",
            "_url": "/test/items/cf688dba-747b-4fbe-8a02-ff8730e2a7c9",
            "id": "cf688dba-747b-4fbe-8a02-ff8730e2a7c9",
          },
          "parentId": "cf688dba-747b-4fbe-8a02-ff8730e2a7c9",
        },
      }
    `);
    expect(queries).toMatchInlineSnapshot(`
      Array [
        "insert into test.items (id) values (?) returning *",
        "select items.id from test.items where items.id = ? limit ?",
        "insert into test.subitems (id, parent_id) values (?, ?) returning *",
        "select subitems.id, subitems.parent_id from test.subitems where subitems.id = ? limit ?",
      ]
    `);
  });
});

describe("beforeCommit", () => {
  it("calls before commit correctly", async () => {
    await knex.schema.withSchema("test").createTable("items", (t) => {
      t.bigIncrements("id").primary();
      t.text("body").defaultTo("").notNullable();
    });

    type Context = {
      id: number;
    };

    let results: [Context, Mode, any, any][] = [];

    const items = new Table<Context>({
      schemaName: "test",
      tableName: "items",
      async afterUpdate(_trx, context, mode, next, previous) {
        results.push([context, mode, next, previous]);
      },
    });

    await items.init(knex);

    expect(await items.write(knex, {}, { id: 1 })).toMatchInlineSnapshot(`
      Object {
        "changes": Array [
          Object {
            "mode": "insert",
            "row": Object {
              "body": "",
              "id": 1,
            },
            "schemaName": "test",
            "tableName": "items",
          },
        ],
        "result": Object {
          "_links": Object {},
          "_type": "test/items",
          "_url": "/test/items/1",
          "body": "",
          "id": 1,
        },
      }
    `);
    expect(results).toMatchInlineSnapshot(`
      Array [
        Array [
          Object {
            "id": 1,
          },
          "insert",
          Object {
            "body": "",
            "id": 1,
          },
          undefined,
        ],
      ]
    `);

    results = [];
    expect(await items.write(knex, { id: 1, body: "abc" }, { id: 1 }))
      .toMatchInlineSnapshot(`
      Object {
        "changes": Array [
          Object {
            "mode": "update",
            "row": Object {
              "body": "abc",
              "id": 1,
            },
            "schemaName": "test",
            "tableName": "items",
          },
        ],
        "result": Object {
          "_links": Object {},
          "_type": "test/items",
          "_url": "/test/items/1",
          "body": "abc",
          "id": 1,
        },
      }
    `);
    expect(results).toMatchInlineSnapshot(`
      Array [
        Array [
          Object {
            "id": 1,
          },
          "update",
          Object {
            "body": "abc",
            "id": 1,
          },
          Object {
            "body": "",
            "id": 1,
          },
        ],
      ]
    `);

    results = [];
    expect(await items.write(knex, { id: 1, _delete: true }, { id: 1 }))
      .toMatchInlineSnapshot(`
      Object {
        "changes": Array [
          Object {
            "mode": "delete",
            "row": Object {
              "body": "abc",
              "id": 1,
            },
            "schemaName": "test",
            "tableName": "items",
          },
        ],
        "result": null,
      }
    `);
    expect(results).toMatchInlineSnapshot(`
      Array [
        Array [
          Object {
            "id": 1,
          },
          "delete",
          undefined,
          Object {
            "body": "abc",
            "id": 1,
          },
        ],
      ]
    `);
  });
});

describe("self references", () => {
  it("can reference self", async () => {
    await knex.schema.withSchema("test").createTable("items", (t) => {
      t.bigIncrements("id").primary();
    });

    await knex.schema.withSchema("test").alterTable("items", (t) => {
      t.bigInteger("parent_item_id").references("id").inTable("test.items");
    });

    const items = new Table({
      schemaName: "test",
      tableName: "items",
    });

    await items.init(knex);
    items.linkTables([items]);

    expect(await items.write(knex, {}, {})).toMatchInlineSnapshot(`
      Object {
        "changes": Array [
          Object {
            "mode": "insert",
            "row": Object {
              "id": 1,
              "parentItemId": null,
            },
            "schemaName": "test",
            "tableName": "items",
          },
        ],
        "result": Object {
          "_links": Object {
            "items": "/test/items?parentItemId=1",
          },
          "_type": "test/items",
          "_url": "/test/items/1",
          "id": 1,
          "parentItemId": null,
        },
      }
    `);

    expect(await items.write(knex, { parentItemId: 1 }, {}))
      .toMatchInlineSnapshot(`
      Object {
        "changes": Array [
          Object {
            "mode": "insert",
            "row": Object {
              "id": 2,
              "parentItemId": 1,
            },
            "schemaName": "test",
            "tableName": "items",
          },
        ],
        "result": Object {
          "_links": Object {
            "items": "/test/items?parentItemId=2",
            "parentItem": "/test/items/1",
          },
          "_type": "test/items",
          "_url": "/test/items/2",
          "id": 2,
          "parentItemId": 1,
        },
      }
    `);

    expect(await items.write(knex, { parentItemId: 1 }, {}))
      .toMatchInlineSnapshot(`
      Object {
        "changes": Array [
          Object {
            "mode": "insert",
            "row": Object {
              "id": 3,
              "parentItemId": 1,
            },
            "schemaName": "test",
            "tableName": "items",
          },
        ],
        "result": Object {
          "_links": Object {
            "items": "/test/items?parentItemId=3",
            "parentItem": "/test/items/1",
          },
          "_type": "test/items",
          "_url": "/test/items/3",
          "id": 3,
          "parentItemId": 1,
        },
      }
    `);

    queries = [];
    expect(await items.read(knex, { include: "parentItem" }, {}))
      .toMatchInlineSnapshot(`
      Object {
        "data": Array [
          Object {
            "_links": Object {
              "items": "/test/items?parentItemId=1",
            },
            "_type": "test/items",
            "_url": "/test/items/1",
            "id": 1,
            "parentItem": null,
            "parentItemId": null,
          },
          Object {
            "_links": Object {
              "items": "/test/items?parentItemId=2",
              "parentItem": "/test/items/1",
            },
            "_type": "test/items",
            "_url": "/test/items/2",
            "id": 2,
            "parentItem": Object {
              "_links": Object {
                "items": "/test/items?parentItemId=1",
              },
              "_type": "test/items",
              "_url": "/test/items/1",
              "id": 1,
              "parentItemId": null,
            },
            "parentItemId": 1,
          },
          Object {
            "_links": Object {
              "items": "/test/items?parentItemId=3",
              "parentItem": "/test/items/1",
            },
            "_type": "test/items",
            "_url": "/test/items/3",
            "id": 3,
            "parentItem": Object {
              "_links": Object {
                "items": "/test/items?parentItemId=1",
              },
              "_type": "test/items",
              "_url": "/test/items/1",
              "id": 1,
              "parentItemId": null,
            },
            "parentItemId": 1,
          },
        ],
        "meta": Object {
          "_collection": "test/items",
          "_links": Object {
            "count": "/test/items/count?include=parentItem",
            "ids": "/test/items/ids?include=parentItem",
          },
          "_type": "collection",
          "_url": "/test/items?include=parentItem",
          "hasMore": false,
          "limit": 50,
          "page": 0,
        },
      }
    `);
    expect(queries).toMatchInlineSnapshot(`
      Array [
        "select items.id, items.parent_item_id, (select row_to_json(items__self_ref_alias_0_sub_query) from (select items__self_ref_alias_0.id, items__self_ref_alias_0.parent_item_id from test.items items__self_ref_alias_0 where items__self_ref_alias_0.id = items.parent_item_id limit ?) items__self_ref_alias_0_sub_query) as parent_item from test.items order by items.id asc limit ?",
      ]
    `);

    queries = [];
    expect(await items.read(knex, { include: "items" }, {}))
      .toMatchInlineSnapshot(`
      Object {
        "data": Array [
          Object {
            "_links": Object {
              "items": "/test/items?parentItemId=1",
            },
            "_type": "test/items",
            "_url": "/test/items/1",
            "id": 1,
            "items": Array [
              Object {
                "_links": Object {
                  "items": "/test/items?parentItemId=2",
                  "parentItem": "/test/items/1",
                },
                "_type": "test/items",
                "_url": "/test/items/2",
                "id": 2,
                "parentItemId": 1,
              },
              Object {
                "_links": Object {
                  "items": "/test/items?parentItemId=3",
                  "parentItem": "/test/items/1",
                },
                "_type": "test/items",
                "_url": "/test/items/3",
                "id": 3,
                "parentItemId": 1,
              },
            ],
            "parentItemId": null,
          },
          Object {
            "_links": Object {
              "items": "/test/items?parentItemId=2",
              "parentItem": "/test/items/1",
            },
            "_type": "test/items",
            "_url": "/test/items/2",
            "id": 2,
            "items": Array [],
            "parentItemId": 1,
          },
          Object {
            "_links": Object {
              "items": "/test/items?parentItemId=3",
              "parentItem": "/test/items/1",
            },
            "_type": "test/items",
            "_url": "/test/items/3",
            "id": 3,
            "items": Array [],
            "parentItemId": 1,
          },
        ],
        "meta": Object {
          "_collection": "test/items",
          "_links": Object {
            "count": "/test/items/count?include=items",
            "ids": "/test/items/ids?include=items",
          },
          "_type": "collection",
          "_url": "/test/items?include=items",
          "hasMore": false,
          "limit": 50,
          "page": 0,
        },
      }
    `);
    expect(queries).toMatchInlineSnapshot(`
      Array [
        "select items.id, items.parent_item_id, array(select row_to_json(items__self_ref_alias_0_sub_query) from (select items__self_ref_alias_0.id, items__self_ref_alias_0.parent_item_id from test.items items__self_ref_alias_0 where items__self_ref_alias_0.parent_item_id = items.id limit ?) items__self_ref_alias_0_sub_query) as items from test.items order by items.id asc limit ?",
      ]
    `);
  });
});

describe("sorts", () => {
  it("can sort", async () => {
    await knex.schema.withSchema("test").createTable("items", (t) => {
      t.bigIncrements("id").primary();
      t.integer("key1").notNullable().defaultTo(0);
      t.integer("key2").notNullable().defaultTo(0);
    });

    await knex("test.items").insert({ key1: 1, key2: 3 });
    await knex("test.items").insert({ key1: 5, key2: 2 });
    await knex("test.items").insert({ key1: 4, key2: 7 });

    const items = new Table({
      schemaName: "test",
      tableName: "items",
    });

    await items.init(knex);

    queries = [];
    expect(await items.read(knex, { sort: "-key1" }, {}))
      .toMatchInlineSnapshot(`
      Object {
        "data": Array [
          Object {
            "_links": Object {},
            "_type": "test/items",
            "_url": "/test/items/2",
            "id": 2,
            "key1": 5,
            "key2": 2,
          },
          Object {
            "_links": Object {},
            "_type": "test/items",
            "_url": "/test/items/3",
            "id": 3,
            "key1": 4,
            "key2": 7,
          },
          Object {
            "_links": Object {},
            "_type": "test/items",
            "_url": "/test/items/1",
            "id": 1,
            "key1": 1,
            "key2": 3,
          },
        ],
        "meta": Object {
          "_collection": "test/items",
          "_links": Object {
            "count": "/test/items/count?sort=-key1",
            "ids": "/test/items/ids?sort=-key1",
          },
          "_type": "collection",
          "_url": "/test/items?sort=-key1",
          "hasMore": false,
          "limit": 50,
          "page": 0,
        },
      }
    `);
    expect(queries).toMatchInlineSnapshot(`
      Array [
        "select items.id, items.key1, items.key2 from test.items order by items.key1 desc limit ?",
      ]
    `);

    queries = [];
    expect(await items.read(knex, { sort: ["key2", "-key1"] }, {}))
      .toMatchInlineSnapshot(`
      Object {
        "data": Array [
          Object {
            "_links": Object {},
            "_type": "test/items",
            "_url": "/test/items/2",
            "id": 2,
            "key1": 5,
            "key2": 2,
          },
          Object {
            "_links": Object {},
            "_type": "test/items",
            "_url": "/test/items/1",
            "id": 1,
            "key1": 1,
            "key2": 3,
          },
          Object {
            "_links": Object {},
            "_type": "test/items",
            "_url": "/test/items/3",
            "id": 3,
            "key1": 4,
            "key2": 7,
          },
        ],
        "meta": Object {
          "_collection": "test/items",
          "_links": Object {
            "count": "/test/items/count?sort[]=key2&sort[]=-key1",
            "ids": "/test/items/ids?sort[]=key2&sort[]=-key1",
          },
          "_type": "collection",
          "_url": "/test/items?sort[]=key2&sort[]=-key1",
          "hasMore": false,
          "limit": 50,
          "page": 0,
        },
      }
    `);
    expect(queries).toMatchInlineSnapshot(`
      Array [
        "select items.id, items.key1, items.key2 from test.items order by items.key2 asc, items.key1 desc limit ?",
      ]
    `);

    queries = [];
    expect(await items.read(knex, { sort: "bogus" }, {}))
      .toMatchInlineSnapshot(`
      Object {
        "data": Array [
          Object {
            "_links": Object {},
            "_type": "test/items",
            "_url": "/test/items/1",
            "id": 1,
            "key1": 1,
            "key2": 3,
          },
          Object {
            "_links": Object {},
            "_type": "test/items",
            "_url": "/test/items/2",
            "id": 2,
            "key1": 5,
            "key2": 2,
          },
          Object {
            "_links": Object {},
            "_type": "test/items",
            "_url": "/test/items/3",
            "id": 3,
            "key1": 4,
            "key2": 7,
          },
        ],
        "meta": Object {
          "_collection": "test/items",
          "_links": Object {
            "count": "/test/items/count?sort=bogus",
            "ids": "/test/items/ids?sort=bogus",
          },
          "_type": "collection",
          "_url": "/test/items?sort=bogus",
          "hasMore": false,
          "limit": 50,
          "page": 0,
        },
      }
    `);
    expect(queries).toMatchInlineSnapshot(`
      Array [
        "select items.id, items.key1, items.key2 from test.items order by items.id asc limit ?",
      ]
    `);
  });
});

describe("pagination", () => {
  let seed: number = 1;
  function random(max: number) {
    const x = Math.sin(seed++) * 10000;
    return Math.floor((x - Math.floor(x)) * max);
  }

  it("can paginate with cursors", async () => {
    seed = 1;

    await knex.schema.withSchema("test").createTable("items", (t) => {
      t.bigIncrements("id").primary();
      t.integer("key1").notNullable().defaultTo(0);
      t.integer("key2").notNullable().defaultTo(0);
    });

    for (let i = 0; i < 1000; i++)
      await knex("test.items").insert({ key1: random(100), key2: random(100) });

    const items = new Table({
      schemaName: "test",
      tableName: "items",
    });

    await items.init(knex);

    queries = [];
    const {
      data: [item1],
      meta: meta1,
    } = await items.read(knex, { sort: ["-key1", "key2"] }, {});
    expect(meta1).toMatchInlineSnapshot(`
      Object {
        "_collection": "test/items",
        "_links": Object {
          "count": "/test/items/count?sort[]=-key1&sort[]=key2",
          "ids": "/test/items/ids?sort[]=-key1&sort[]=key2",
          "nextPage": "/test/items?sort[]=-key1&sort[]=key2&cursor=eyJpZCI6NzYyLCJrZXkxIjo5NCwia2V5MiI6NjN9",
        },
        "_type": "collection",
        "_url": "/test/items?sort[]=-key1&sort[]=key2",
        "hasMore": true,
        "limit": 50,
        "page": 0,
      }
    `);
    expect(queries).toMatchInlineSnapshot(`
      Array [
        "select items.id, items.key1, items.key2 from test.items order by items.key1 desc, items.key2 asc limit ?",
      ]
    `);
    expect(item1).toMatchInlineSnapshot(`
      Object {
        "_links": Object {},
        "_type": "test/items",
        "_url": "/test/items/882",
        "id": 882,
        "key1": 99,
        "key2": 9,
      }
    `);

    const url = new URL(meta1._links.nextPage, "http://localhost");
    const params = QueryString.parse(url.search.slice(1));

    queries = [];
    const {
      data: [item2],
      meta: meta2,
    } = await items.read(knex, params, {});
    expect(meta2).toMatchInlineSnapshot(`
      Object {
        "_collection": "test/items",
        "_links": Object {
          "count": "/test/items/count?sort[]=-key1&sort[]=key2&cursor=eyJpZCI6NzYyLCJrZXkxIjo5NCwia2V5MiI6NjN9",
          "ids": "/test/items/ids?sort[]=-key1&sort[]=key2&cursor=eyJpZCI6NzYyLCJrZXkxIjo5NCwia2V5MiI6NjN9",
          "nextPage": "/test/items?sort[]=-key1&sort[]=key2&cursor=eyJpZCI6MjQwLCJrZXkxIjo4OSwia2V5MiI6MTZ9",
        },
        "_type": "collection",
        "_url": "/test/items?sort[]=-key1&sort[]=key2&cursor=eyJpZCI6NzYyLCJrZXkxIjo5NCwia2V5MiI6NjN9",
        "hasMore": true,
        "limit": 50,
        "page": 0,
      }
    `);
    expect(queries).toMatchInlineSnapshot(`
      Array [
        "select items.id, items.key1, items.key2 from test.items where ((items.key1 < ?) or (items.key1 = ? and items.key2 > ?)) order by items.key1 desc, items.key2 asc limit ?",
      ]
    `);
    expect(item2).toMatchInlineSnapshot(`
      Object {
        "_links": Object {},
        "_type": "test/items",
        "_url": "/test/items/628",
        "id": 628,
        "key1": 94,
        "key2": 64,
      }
    `);
  });
});

describe("in public schema", () => {
  it("tables can exist in the public schema", async () => {
    await knex.schema.createTable("test_table", (t) => {
      t.bigIncrements("id").primary();
    });

    const items = new Table({
      tableName: "testTable",
    });

    await items.init(knex);

    queries = [];
    expect(await items.write(knex, {}, {})).toMatchInlineSnapshot(`
      Object {
        "changes": Array [
          Object {
            "mode": "insert",
            "row": Object {
              "id": 1,
            },
            "schemaName": "public",
            "tableName": "testTable",
          },
        ],
        "result": Object {
          "_links": Object {},
          "_type": "testTable",
          "_url": "/testTable/1",
          "id": 1,
        },
      }
    `);
    expect(queries).toMatchInlineSnapshot(`
      Array [
        "insert into public.test_table default values returning *",
        "select test_table.id from public.test_table where test_table.id = ? limit ?",
      ]
    `);

    queries = [];
    expect(await items.read(knex, {}, {})).toMatchInlineSnapshot(`
      Object {
        "data": Array [
          Object {
            "_links": Object {},
            "_type": "testTable",
            "_url": "/testTable/1",
            "id": 1,
          },
        ],
        "meta": Object {
          "_collection": "testTable",
          "_links": Object {
            "count": "/testTable/count",
            "ids": "/testTable/ids",
          },
          "_type": "collection",
          "_url": "/testTable",
          "hasMore": false,
          "limit": 50,
          "page": 0,
        },
      }
    `);
    expect(queries).toMatchInlineSnapshot(`
      Array [
        "select test_table.id from public.test_table order by test_table.id asc limit ?",
      ]
    `);
  });
});
