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
  it("works with auto-updatable views", async () => {
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
      t.bigInteger("orgId")
        .references("id")
        .inTable("viewTest.orgs")
        .notNullable();
    });

    await knex.raw(`
      create view view_test.view as
        select
          id,
          is_boolean,
          number_count,
          text as body,
          text || ' appended' as body_appended,
          org_id
        from view_test.test where is_boolean
    `);

    const orgs = new Table({
      schemaName: "viewTest",
      tableName: "orgs",
    });

    const testTable = new Table({
      schemaName: "viewTest",
      tableName: "test",
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
      readOnlyColumns: ["bodyAppended"],
      dependsOn: ["viewTest.test"],
    });

    await table.init(knex);
    await orgs.init(knex);
    await testTable.init(knex);
    orgs.linkTables([table, orgs, testTable]);
    table.linkTables([table, orgs, testTable]);
    testTable.linkTables([table, orgs, testTable]);

    const [org] = await knex("viewTest.orgs").insert({}).returning("*");
    for (let i = 0; i < 2; i++)
      await knex("viewTest.test").insert({
        isBoolean: i % 2 === 0,
        orgId: org.id,
      });

    expect(table.columns).toMatchInlineSnapshot(`
      Object {
        "body": Object {
          "defaultValue": null,
          "length": 10,
          "name": "body",
          "nullable": true,
          "type": "character varying",
        },
        "bodyAppended": Object {
          "defaultValue": null,
          "length": -1,
          "name": "bodyAppended",
          "nullable": true,
          "type": "text",
        },
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
            "body": "text",
            "bodyAppended": "text appended",
            "id": 1,
            "isBoolean": true,
            "numberCount": 0,
            "org": Object {
              "_links": Object {
                "test": "/viewTest/test?orgId=1",
                "testCount": "/viewTest/orgs/1/testCount",
                "view": "/viewTest/view?orgId=1",
                "viewCount": "/viewTest/orgs/1/viewCount",
              },
              "_type": "viewTest/orgs",
              "_url": "/viewTest/orgs/1",
              "id": 1,
            },
            "orgId": 1,
          },
        ],
        "limit": 50,
        "page": 0,
      }
    `);
    expect(queries).toMatchInlineSnapshot(`
      Array [
        "select view.id, view.is_boolean, view.number_count, view.body, view.body_appended, view.org_id, (select row_to_json(orgs__alias_0_sub_query) from (select orgs__alias_0.id from view_test.orgs orgs__alias_0 where orgs__alias_0.id = view.org_id limit ?) orgs__alias_0_sub_query) as org from view_test.view order by view.id asc limit ?",
      ]
    `);

    queries = [];
    expect(await orgs.readMany(knex, { include: "view" }, {}))
      .toMatchInlineSnapshot(`
      Object {
        "_links": Object {
          "count": "/viewTest/orgs/count?include=view",
          "ids": "/viewTest/orgs/ids?include=view",
        },
        "_type": "viewTest/orgs",
        "_url": "/viewTest/orgs?include=view",
        "hasMore": false,
        "items": Array [
          Object {
            "_links": Object {
              "test": "/viewTest/test?orgId=1",
              "testCount": "/viewTest/orgs/1/testCount",
              "view": "/viewTest/view?orgId=1",
              "viewCount": "/viewTest/orgs/1/viewCount",
            },
            "_type": "viewTest/orgs",
            "_url": "/viewTest/orgs/1",
            "id": 1,
            "view": Array [
              Object {
                "_links": Object {
                  "org": "/viewTest/orgs/1",
                },
                "_type": "viewTest/view",
                "_url": "/viewTest/view/1",
                "body": "text",
                "bodyAppended": "text appended",
                "id": 1,
                "isBoolean": true,
                "numberCount": 0,
                "orgId": 1,
              },
            ],
          },
        ],
        "limit": 50,
        "page": 0,
      }
    `);
    expect(queries).toMatchInlineSnapshot(`
      Array [
        "select orgs.id, array(select row_to_json(view__alias_0_sub_query) from (select view__alias_0.id, view__alias_0.is_boolean, view__alias_0.number_count, view__alias_0.body, view__alias_0.body_appended, view__alias_0.org_id from view_test.view view__alias_0 where view__alias_0.org_id = orgs.id limit ?) view__alias_0_sub_query) as view from view_test.orgs order by orgs.id asc limit ?",
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
        "select view.id, view.is_boolean, view.number_count, view.body, view.body_appended, view.org_id from view_test.view where view.id = ? limit ?",
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
    expect(
      await table.write(
        knex,
        { isBoolean: true, body: "body text", orgId: org.id },
        {}
      )
    ).toMatchInlineSnapshot(`
      Object {
        "changeId": "uuid-test-value",
        "changes": Array [
          Object {
            "mode": "insert",
            "path": "/viewTest/view",
            "row": Object {
              "_links": Object {
                "org": "/viewTest/orgs/1",
              },
              "_type": "viewTest/view",
              "_url": "/viewTest/view/4",
              "body": "body text",
              "bodyAppended": "body text appended",
              "id": 4,
              "isBoolean": true,
              "numberCount": 0,
              "orgId": 1,
            },
            "views": undefined,
          },
        ],
        "result": Object {
          "_links": Object {
            "org": "/viewTest/orgs/1",
          },
          "_type": "viewTest/view",
          "_url": "/viewTest/view/4",
          "body": "body text",
          "bodyAppended": "body text appended",
          "id": 4,
          "isBoolean": true,
          "numberCount": 0,
          "orgId": 1,
        },
      }
    `);
    expect(queries).toMatchInlineSnapshot(`
      Array [
        "select orgs.id from view_test.orgs where orgs.id = ? limit ?",
        "insert into view_test.view (body, is_boolean, org_id) values (?, ?, ?) returning *",
        "select view.id, view.is_boolean, view.number_count, view.body, view.body_appended, view.org_id from view_test.view where view.id = ? limit ?",
      ]
    `);

    queries = [];
    expect(
      await table.write(
        knex,
        { isBoolean: true, bodyAppended: "body text", orgId: org.id },
        {}
      )
    ).toMatchInlineSnapshot(`
      Object {
        "changeId": "uuid-test-value",
        "changes": Array [
          Object {
            "mode": "insert",
            "path": "/viewTest/view",
            "row": Object {
              "_links": Object {
                "org": "/viewTest/orgs/1",
              },
              "_type": "viewTest/view",
              "_url": "/viewTest/view/5",
              "body": "text",
              "bodyAppended": "text appended",
              "id": 5,
              "isBoolean": true,
              "numberCount": 0,
              "orgId": 1,
            },
            "views": undefined,
          },
        ],
        "result": Object {
          "_links": Object {
            "org": "/viewTest/orgs/1",
          },
          "_type": "viewTest/view",
          "_url": "/viewTest/view/5",
          "body": "text",
          "bodyAppended": "text appended",
          "id": 5,
          "isBoolean": true,
          "numberCount": 0,
          "orgId": 1,
        },
      }
    `);
    expect(queries).toMatchInlineSnapshot(`
      Array [
        "select orgs.id from view_test.orgs where orgs.id = ? limit ?",
        "insert into view_test.view (is_boolean, org_id) values (?, ?) returning *",
        "select view.id, view.is_boolean, view.number_count, view.body, view.body_appended, view.org_id from view_test.view where view.id = ? limit ?",
      ]
    `);

    queries = [];
    expect(
      await testTable.write(
        knex,
        { isBoolean: true, body: "body text", orgId: org.id },
        {}
      )
    ).toMatchInlineSnapshot(`
      Object {
        "changeId": "uuid-test-value",
        "changes": Array [
          Object {
            "mode": "insert",
            "path": "/viewTest/test",
            "row": Object {
              "_links": Object {
                "org": "/viewTest/orgs/1",
              },
              "_type": "viewTest/test",
              "_url": "/viewTest/test/6",
              "id": 6,
              "isBoolean": true,
              "numberCount": 0,
              "orgId": 1,
              "text": "text",
            },
            "views": Array [
              "/viewTest/view",
            ],
          },
        ],
        "result": Object {
          "_links": Object {
            "org": "/viewTest/orgs/1",
          },
          "_type": "viewTest/test",
          "_url": "/viewTest/test/6",
          "id": 6,
          "isBoolean": true,
          "numberCount": 0,
          "orgId": 1,
          "text": "text",
        },
      }
    `);
  });

  it("works with instead of", async () => {
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
      t.bigInteger("orgId")
        .references("id")
        .inTable("viewTest.orgs")
        .notNullable();
    });

    await knex.raw(`
      create view view_test.view as
        select
          *
        from view_test.test where is_boolean;

      create or replace function view_test.view_update_row() returns trigger as $$
        declare
          row_id bigint;
          new_row view_test.view%ROWTYPE;
        begin
          if (tg_op = 'DELETE') then
            delete from view_test.test
            where test.id = new.id;

            return old;
          elsif (tg_op = 'UPDATE') then
            update view_test.test
            set number_count = new.number_count
            where id = old.id
            returning id into row_id;

            select * from view_test.view where id=row_id into new_row;
            
            return new_row;
          elsif (tg_op = 'INSERT') then
            insert into view_test.test(is_boolean, number_count, org_id)
            values (new.is_boolean, new.number_count, new.org_id)
            returning id into row_id;

            select * from view_test.view where id=row_id into new_row;
            
            return new_row;
          
          end if;
        end;
      $$ language plpgsql;

      create trigger view_update
      instead of insert or update or delete on view_test.view
      for each row execute procedure view_test.view_update_row();
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
      async defaultParams() {
        return {
          isBoolean: true,
        };
      },
      dependsOn: ["viewTest.test"],
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
          "count": "/viewTest/view/count?isBoolean=true&include=org",
          "ids": "/viewTest/view/ids?isBoolean=true&include=org",
        },
        "_type": "viewTest/view",
        "_url": "/viewTest/view?isBoolean=true&include=org",
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
                "viewCount": "/viewTest/orgs/1/viewCount",
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
        "select view.id, view.is_boolean, view.number_count, view.text, view.org_id, (select row_to_json(orgs__alias_0_sub_query) from (select orgs__alias_0.id from view_test.orgs orgs__alias_0 where orgs__alias_0.id = view.org_id limit ?) orgs__alias_0_sub_query) as org from view_test.view where (view.is_boolean = ?) order by view.id asc limit ?",
      ]
    `);

    queries = [];
    expect(await table.write(knex, { numberCount: 718, orgId: 1 }, {}))
      .toMatchInlineSnapshot(`
      Object {
        "changeId": "uuid-test-value",
        "changes": Array [
          Object {
            "mode": "insert",
            "path": "/viewTest/view",
            "row": Object {
              "_links": Object {
                "org": "/viewTest/orgs/1",
              },
              "_type": "viewTest/view",
              "_url": "/viewTest/view/3",
              "id": 3,
              "isBoolean": true,
              "numberCount": 718,
              "orgId": 1,
              "text": "text",
            },
            "views": undefined,
          },
        ],
        "result": Object {
          "_links": Object {
            "org": "/viewTest/orgs/1",
          },
          "_type": "viewTest/view",
          "_url": "/viewTest/view/3",
          "id": 3,
          "isBoolean": true,
          "numberCount": 718,
          "orgId": 1,
          "text": "text",
        },
      }
    `);
    expect(queries).toMatchInlineSnapshot(`
      Array [
        "select orgs.id from view_test.orgs where orgs.id = ? limit ?",
        "insert into view_test.view (is_boolean, number_count, org_id) values (?, ?, ?) returning *",
        "select view.id, view.is_boolean, view.number_count, view.text, view.org_id from view_test.view where view.id = ? limit ?",
      ]
    `);

    queries = [];
    expect(await table.write(knex, { id: 3, _delete: true }, {}))
      .toMatchInlineSnapshot(`
      Object {
        "changeId": "uuid-test-value",
        "changes": Array [
          Object {
            "mode": "delete",
            "path": "/viewTest/view",
            "row": Object {
              "_links": Object {
                "org": "/viewTest/orgs/1",
              },
              "_type": "viewTest/view",
              "_url": "/viewTest/view/3",
              "id": 3,
              "isBoolean": true,
              "numberCount": 718,
              "orgId": 1,
              "text": "text",
            },
            "views": undefined,
          },
        ],
        "result": null,
      }
    `);
    expect(queries).toMatchInlineSnapshot(`
      Array [
        "select view.id, view.is_boolean, view.number_count, view.text, view.org_id from view_test.view where view.id = ? limit ?",
        "delete from view_test.view where view.id = ?",
      ]
    `);
  });
});
