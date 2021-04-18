import Knex from "knex";
import { knexHelpers, Relation, Table } from "../src";
import uuid from "uuid";

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

  const anonymousId = "uuid-test-value";
  jest.spyOn(uuid, "v4").mockReturnValue(anonymousId);
});

afterEach(() => {
  queries = [];
});

afterAll(async () => {
  await knex.destroy();
});

describe("works with views", () => {
  it("reads", async () => {
    await knex.schema.withSchema("test").createTable("orgs", (t) => {
      t.bigIncrements("id").primary();
    });

    await knex.schema.withSchema("test").createTable("test", (t) => {
      t.bigIncrements("id").primary();
      t.boolean("is_boolean").notNullable().defaultTo(false);
      t.integer("number_count").notNullable().defaultTo(0);
      t.specificType("text", "character varying(10)")
        .notNullable()
        .defaultTo("text");
      t.bigInteger("orgId").references("id").inTable("test.orgs").notNullable();
    });

    await knex.raw(`
      create view test.view as
        select * from test.test where is_boolean
    `);

    const orgs = new Table({
      schemaName: "test",
      tableName: "orgs",
    });

    const table = new Table({
      schemaName: "test",
      tableName: "view",
      relations: {
        org: new Relation({
          columnName: "orgId",
          referencesSchema: "test",
          referencesTable: "orgs",
        }),
      },
    });

    await table.init(knex);
    await orgs.init(knex);
    orgs.linkTables([table]);
    table.linkTables([orgs]);

    const [org] = await knex("test.orgs").insert({}).returning("*");
    for (let i = 0; i < 2; i++)
      await knex("test.test").insert({ isBoolean: i % 2 === 0, orgId: org.id });

    expect(table.columns).toMatchInlineSnapshot(`
      Object {
        "id": Object {
          "defaultValue": null,
          "length": -1,
          "name": "id",
          "nullable": true,
          "type": "bigint",
        },
        "isBoolean": Object {
          "defaultValue": null,
          "length": -1,
          "name": "isBoolean",
          "nullable": true,
          "type": "boolean",
        },
        "numberCount": Object {
          "defaultValue": null,
          "length": -1,
          "name": "numberCount",
          "nullable": true,
          "type": "integer",
        },
        "orgId": Object {
          "defaultValue": null,
          "length": -1,
          "name": "orgId",
          "nullable": true,
          "type": "bigint",
        },
        "text": Object {
          "defaultValue": null,
          "length": 10,
          "name": "text",
          "nullable": true,
          "type": "character varying",
        },
      }
    `);

    queries = [];
    expect(await table.readMany(knex, { include: "org" }, {}))
      .toMatchInlineSnapshot(`
      Object {
        "_links": Object {
          "count": "/test/view/count?include=org",
          "ids": "/test/view/ids?include=org",
        },
        "_type": "test/view",
        "_url": "/test/view?include=org",
        "hasMore": false,
        "items": Array [
          Object {
            "_links": Object {
              "org": "/test/orgs/1",
            },
            "_type": "test/view",
            "_url": "/test/view/1",
            "id": 1,
            "isBoolean": true,
            "numberCount": 0,
            "org": Object {
              "_links": Object {
                "view": "/test/view?orgId=1",
              },
              "_type": "test/orgs",
              "_url": "/test/orgs/1",
              "id": 1,
            },
            "orgId": 1,
            "text": "text",
          },
        ],
        "limit": 50,
        "page": 0,
      }
    `);
    expect(queries).toMatchInlineSnapshot(`
      Array [
        "select view.id, view.is_boolean, view.number_count, view.text, view.org_id, (select row_to_json(orgs_sub_query) from (select orgs.id from test.orgs where orgs.id = view.org_id limit ?) orgs_sub_query) as org from test.view order by view.id asc limit ?",
      ]
    `);

    queries = [];
    expect(
      await table
        .write(knex, { isBoolean: false, orgId: org.id }, {})
        .catch((e) => e.body)
    ).toMatchInlineSnapshot(`
      Object {
        "errors": Object {
          "base": "Unauthorized",
        },
      }
    `);
    expect(queries).toMatchInlineSnapshot(`
      Array [
        "select orgs.id from test.orgs where orgs.id = ? limit ?",
        "insert into test.view (is_boolean, org_id) values (?, ?) returning *",
        "select view.id, view.is_boolean, view.number_count, view.text, view.org_id from test.view where view.id = ? limit ?",
      ]
    `);

    queries = [];
    expect(await table.write(knex, { isBoolean: true, orgId: org.id }, {}))
      .toMatchInlineSnapshot(`
      Object {
        "changeId": "uuid-test-value",
        "changes": Array [
          Object {
            "mode": "insert",
            "path": "test/view",
            "row": Object {
              "_links": Object {
                "org": "/test/orgs/1",
              },
              "_type": "test/view",
              "_url": "/test/view/4",
              "id": 4,
              "isBoolean": true,
              "numberCount": 0,
              "orgId": 1,
              "text": "text",
            },
          },
        ],
        "item": Object {
          "_links": Object {
            "org": "/test/orgs/1",
          },
          "_type": "test/view",
          "_url": "/test/view/4",
          "id": 4,
          "isBoolean": true,
          "numberCount": 0,
          "orgId": 1,
          "text": "text",
        },
      }
    `);
    expect(queries).toMatchInlineSnapshot(`
      Array [
        "select orgs.id from test.orgs where orgs.id = ? limit ?",
        "insert into test.view (is_boolean, org_id) values (?, ?) returning *",
        "select view.id, view.is_boolean, view.number_count, view.text, view.org_id from test.view where view.id = ? limit ?",
      ]
    `);
  });
});
