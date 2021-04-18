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
    drop schema if exists view_test cascade;
    create schema view_test;
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
    await knex.schema.withSchema("viewTest").createTable("orgs", (t) => {
      t.bigIncrements("id").primary();
    });

    await knex.schema.withSchema("viewTest").createTable("test", (t) => {
      t.bigIncrements("id").primary();
      t.boolean("is_boolean").notNullable().defaultTo(false);
      t.integer("number_count").notNullable().defaultTo(0);
      t.specificType("text", "character varying(10)")
        .notNullable()
        .defaultTo("text");
      t.bigInteger("orgId").references("id").inTable("test.orgs").notNullable();
    });

    await knex.raw(`
      create view view_test.view as
        select * from view_test.test where is_boolean
    `);

    const orgs = new Table({
      schemaName: "viewTest",
      tableName: "orgs",
    });

    const table = new Table({
      schemaName: "viewTest",
      tableName: "view",
      relations: {
        org: new Relation({
          columnName: "orgId",
          referencesSchema: "viewTest",
          referencesTable: "orgs",
        }),
      },
    });

    await table.init(knex);
    await orgs.init(knex);
    orgs.linkTables([table]);
    table.linkTables([orgs]);

    const [org] = await knex("viewTest.orgs").insert({}).returning("*");
    for (let i = 0; i < 2; i++)
      await knex("viewTest.test").insert({
        isBoolean: i % 2 === 0,
        orgId: org.id,
      });

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
          "count": "/viewTest/view/count?include=org",
          "ids": "/viewTest/view/ids?include=org",
        },
        "_type": "viewTest/view",
        "_url": "/viewTest/view?include=org",
        "hasMore": false,
        "items": Array [
          Object {
            "_links": Object {
              "org": "/viewTest/orgs/1",
            },
            "_type": "viewTest/view",
            "_url": "/viewTest/view/1",
            "id": 1,
            "isBoolean": true,
            "numberCount": 0,
            "org": Object {
              "_links": Object {
                "view": "/viewTest/view?orgId=1",
              },
              "_type": "viewTest/orgs",
              "_url": "/viewTest/orgs/1",
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
        "select view.id, view.is_boolean, view.number_count, view.text, view.org_id, (select row_to_json(orgs_sub_query) from (select orgs.id from view_test.orgs where orgs.id = view.org_id limit ?) orgs_sub_query) as org from view_test.view order by view.id asc limit ?",
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
        "select orgs.id from view_test.orgs where orgs.id = ? limit ?",
        "insert into view_test.view (is_boolean, org_id) values (?, ?) returning *",
        "select view.id, view.is_boolean, view.number_count, view.text, view.org_id from view_test.view where view.id = ? limit ?",
      ]
    `);

    queries = [];
    expect(
      await table
        .write(knex, { isBoolean: {}, orgId: org.id }, {})
        .catch((e) => e.body)
    ).toMatchInlineSnapshot(`
      Object {
        "errors": Object {
          "isBoolean": "must be a \`boolean\` type, but the final value was: \`{}\`.",
        },
      }
    `);
    expect(queries).toMatchInlineSnapshot(`
      Array [
        "select orgs.id from view_test.orgs where orgs.id = ? limit ?",
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
            "path": "viewTest/view",
            "row": Object {
              "_links": Object {
                "org": "/viewTest/orgs/1",
              },
              "_type": "viewTest/view",
              "_url": "/viewTest/view/4",
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
            "org": "/viewTest/orgs/1",
          },
          "_type": "viewTest/view",
          "_url": "/viewTest/view/4",
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
        "select orgs.id from view_test.orgs where orgs.id = ? limit ?",
        "insert into view_test.view (is_boolean, org_id) values (?, ?) returning *",
        "select view.id, view.is_boolean, view.number_count, view.text, view.org_id from view_test.view where view.id = ? limit ?",
      ]
    `);
  });
});
