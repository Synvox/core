import { createServer } from 'http';
import express, { Application } from 'express';
import axios, { AxiosRequestConfig } from 'axios';
import listen from 'test-listen';
import Knex from 'knex';
import Core, { knexHelpers, ContextFactory } from '../src';
import withTimestamps from '../src/plugins/withTimestamps';

let server: null | ReturnType<typeof createServer> = null;
let user: any = null;

const getContext: ContextFactory<{
  getIdentity(): Promise<any>;
  getUsers(): Promise<any[]>;
}> = () => {
  const getIdentity = async () => {
    return knex('identities').first();
  };

  const getUsers = async () => {
    const identity = await getIdentity();
    return knex('users').where('users.identityId', identity.id);
  };

  return {
    getIdentity,
    getUsers,
  };
};

async function create(
  options?: Partial<AxiosRequestConfig>,
  middlewareHook?: (app: Application) => void
) {
  if (server) {
    server?.close();
    server = null;
  }

  const core = Core(knex, getContext);

  core.table({
    tableName: 'identities',
    hiddenColumns: ['passwordHash'],
    async policy(stmt, { getIdentity }) {
      stmt.where(`${this.alias}.id`, (await getIdentity()).id);
    },
    idModifiers: {
      async me(stmt, { getIdentity }) {
        const ident = await getIdentity();
        stmt.where(`${this.alias}.id`, ident.id);
      },
    },
  });

  core.table(
    withTimestamps({
      tableName: 'users',
      async policy(stmt, { getIdentity }, mode) {
        if (mode === 'read') return;
        stmt.where(`${this.alias}.identityId`, (await getIdentity()).id);
      },
    })
  );

  core.table(
    withTimestamps({
      tableName: 'messages',
      async policy(stmt, { getUsers }, mode) {
        if (mode === 'read') return;
        stmt.whereIn(
          `${this.alias}.userId`,
          (await getUsers()).map(u => u.id)
        );
      },
    })
  );

  core.table(
    withTimestamps({
      tableName: 'likes',
      allowUpserts: true,
      async policy(stmt, { getUsers }, mode) {
        if (mode === 'read') return;
        stmt.whereIn(
          `${this.alias}.userId`,
          (await getUsers()).map(u => u.id)
        );
      },
    })
  );

  const app = express();
  app.use(express.json());
  if (middlewareHook) middlewareHook(app);
  app.use(core);

  // for debugging failures
  // app.use(function(error: any, _req: any, _res: any, next: any) {
  //   console.error(error);
  //   next(error);
  // });

  server = createServer(app);
  const url = await listen(server);
  return {
    ...axios.create({ ...options, baseURL: url }),
    url,
  };
}

let queries: string[] = [];

const knex = Knex({
  client: 'pg',
  connection: {
    database: process.env.USER,
  },
  ...knexHelpers,
  debug: true,
  log: {
    debug: message => {
      queries.push(message.sql);
    },
  },
});

beforeEach(async () => {
  await knex.raw('drop table if exists users cascade');
  await knex.raw('drop table if exists identities cascade');
  await knex.raw('drop table if exists messages cascade');
  await knex.raw('drop table if exists likes cascade');

  await knex.schema.createTable('identities', t => {
    t.bigIncrements('id').primary();
    t.text('email').notNullable();
    t.text('password_hash').notNullable();
  });

  await knex.schema.createTable('users', t => {
    t.bigIncrements('id').primary();
    t.bigInteger('identity_id')
      .references('id')
      .inTable('identities')
      .notNullable();
    t.text('userName').notNullable();
    t.timestamp('created_at', { useTz: true }).defaultTo(knex.raw('now()'));
    t.timestamp('updated_at', { useTz: true }).defaultTo(knex.raw('now()'));
  });

  await knex.schema.createTable('messages', t => {
    t.bigIncrements('id').primary();
    t.bigInteger('user_id')
      .references('id')
      .inTable('users')
      .notNullable();
    t.bigInteger('forward_message_id');
    t.bigInteger('reply_to_message_id');
    t.text('body')
      .defaultTo('')
      .notNullable();
    t.timestamp('created_at', { useTz: true }).defaultTo(knex.raw('now()'));
    t.timestamp('updated_at', { useTz: true }).defaultTo(knex.raw('now()'));
  });

  await knex.schema.alterTable('messages', t => {
    t.foreign('forward_message_id')
      .references('id')
      .inTable('messages');
    t.foreign('reply_to_message_id')
      .references('id')
      .inTable('messages');
  });

  await knex.schema.createTable('likes', t => {
    t.bigIncrements('id').primary();
    t.bigInteger('user_id')
      .references('id')
      .inTable('users')
      .notNullable();
    t.bigInteger('message_id')
      .references('id')
      .inTable('messages')
      .notNullable();
    t.timestamp('created_at', { useTz: true }).defaultTo(knex.raw('now()'));
    t.unique(['user_id', 'message_id']);
  });

  const [ident] = await knex('identities')
    .insert({
      email: 'thing@thang.com',
      passwordHash: 'derp',
    })
    .returning('*');

  const [u] = await knex('users')
    .insert({
      userName: 'User',
      identityId: ident.id,
    })
    .returning('*');
  user = u;

  jest.spyOn(Date, 'now').mockImplementation(() =>
    //@ts-ignore
    Date.parse('2020-01-11')
  );
});

afterEach(() => {
  queries = [];
  if (server) {
    server?.close();
    server = null;
  }
});

afterAll(async () => {
  await knex.raw('drop table if exists users cascade');
  await knex.raw('drop table if exists identities cascade');
  await knex.raw('drop table if exists messages cascade');
  await knex.raw('drop table if exists likes cascade');
  await knex.destroy();
});

it('works', async () => {
  const { get, post, delete: del } = await create();

  expect((await get('/identities/me')).data).toEqual({
    data: {
      '@links': {
        users: '/users?identityId=1',
      },
      '@url': '/identities/1',
      email: 'thing@thang.com',
      id: 1,
    },
  });

  expect(
    (
      await post('/messages', {
        userId: user.id,
        body: 'My First Message',
      })
    ).data
  ).toMatchInlineSnapshot(`
    Object {
      "data": Object {
        "@links": Object {
          "likes": "/likes?messageId=1",
          "user": "/users/1",
        },
        "@url": "/messages/1",
        "body": "My First Message",
        "createdAt": "2020-01-11T00:00:00.000Z",
        "forwardMessageId": null,
        "id": 1,
        "replyToMessageId": null,
        "updatedAt": "2020-01-11T00:00:00.000Z",
        "userId": 1,
      },
    }
  `);

  await post('/messages', {
    userId: user.id,
    body: 'Replying to #1',
    replyToMessageId: 1,
  });

  queries = [];
  expect((await get('/messages?include=replyToMessage')).data)
    .toMatchInlineSnapshot(`
    Object {
      "data": Array [
        Object {
          "@links": Object {
            "likes": "/likes?messageId=1",
            "user": "/users/1",
          },
          "@url": "/messages/1",
          "body": "My First Message",
          "createdAt": "2020-01-11T00:00:00.000Z",
          "forwardMessageId": null,
          "id": 1,
          "replyToMessage": null,
          "replyToMessageId": null,
          "updatedAt": "2020-01-11T00:00:00.000Z",
          "userId": 1,
        },
        Object {
          "@links": Object {
            "likes": "/likes?messageId=2",
            "user": "/users/1",
          },
          "@url": "/messages/2",
          "body": "Replying to #1",
          "createdAt": "2020-01-11T00:00:00.000Z",
          "forwardMessageId": null,
          "id": 2,
          "replyToMessage": Object {
            "@links": Object {
              "likes": "/likes?messageId=1",
              "user": "/users/1",
            },
            "@url": "/messages/1",
            "body": "My First Message",
            "createdAt": "2020-01-10T17:00:00-07:00",
            "forwardMessageId": null,
            "id": 1,
            "replyToMessageId": null,
            "updatedAt": "2020-01-10T17:00:00-07:00",
            "userId": 1,
          },
          "replyToMessageId": 1,
          "updatedAt": "2020-01-11T00:00:00.000Z",
          "userId": 1,
        },
      ],
      "meta": Object {
        "@links": Object {
          "count": "/messages/count?include=replyToMessage",
          "ids": "/messages/ids?include=replyToMessage",
        },
        "@url": "/messages?include=replyToMessage",
        "hasMore": false,
        "limit": 50,
        "page": 0,
      },
    }
  `);

  expect(queries).toMatchInlineSnapshot(`
    Array [
      "select messages.*, (select row_to_json(messages__self_ref_alias_0) from public.messages messages__self_ref_alias_0 where messages__self_ref_alias_0.id = messages.reply_to_message_id limit 1) as reply_to_message from public.messages order by messages.id asc limit ?",
    ]
  `);

  await post('/likes', { userId: 1, messageId: 1 });

  expect((await get('/likes')).data).toMatchInlineSnapshot(`
    Object {
      "data": Array [
        Object {
          "@links": Object {
            "message": "/messages/1",
            "user": "/users/1",
          },
          "@url": "/likes/1",
          "createdAt": "2020-01-11T00:00:00.000Z",
          "id": 1,
          "messageId": 1,
          "userId": 1,
        },
      ],
      "meta": Object {
        "@links": Object {
          "count": "/likes/count",
          "ids": "/likes/ids",
        },
        "@url": "/likes",
        "hasMore": false,
        "limit": 50,
        "page": 0,
      },
    }
  `);

  await post('/likes', { userId: 1, messageId: 1 });
  expect((await get('/likes')).data).toMatchInlineSnapshot(`
    Object {
      "data": Array [
        Object {
          "@links": Object {
            "message": "/messages/1",
            "user": "/users/1",
          },
          "@url": "/likes/1",
          "createdAt": "2020-01-11T00:00:00.000Z",
          "id": 1,
          "messageId": 1,
          "userId": 1,
        },
      ],
      "meta": Object {
        "@links": Object {
          "count": "/likes/count",
          "ids": "/likes/ids",
        },
        "@url": "/likes",
        "hasMore": false,
        "limit": 50,
        "page": 0,
      },
    }
  `);

  expect((await del('/likes/1')).data).toMatchInlineSnapshot(`
    Object {
      "data": null,
    }
  `);

  expect((await get('/likes')).data).toMatchInlineSnapshot(`
    Object {
      "data": Array [],
      "meta": Object {
        "@links": Object {
          "count": "/likes/count",
          "ids": "/likes/ids",
        },
        "@url": "/likes",
        "hasMore": false,
        "limit": 50,
        "page": 0,
      },
    }
  `);

  const [identity2] = await knex('identities')
    .insert({ email: 'e@mail.com', passwordHash: 'hash' })
    .returning('*');
  const [user2] = await knex('users')
    .insert({ userName: 'outside', identityId: identity2.id })
    .returning('*');
  const [like2] = await knex('likes')
    .insert({ messageId: 1, userId: user2.id })
    .returning('*');

  expect((await del(`/likes/${like2.id}`).catch(e => e.response)).status).toBe(
    401
  );
});
