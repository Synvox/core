import { createServer } from 'http';
import { EventEmitter } from 'events';
import express, { Request } from 'express';
import axios, { AxiosRequestConfig } from 'axios';
import listen from 'test-listen';
import Knex, { QueryBuilder } from 'knex';
import Core, { knexHelpers, ContextFactory, notifyChange } from '../src';
import { string } from 'yup';
import withTimestamps from '../src/plugins/withTimestamps';
import { ChangeSummary } from 'Core';

let server: null | ReturnType<typeof createServer> = null;

async function create(
  core: ReturnType<typeof Core>,
  options?: Partial<AxiosRequestConfig>
) {
  const app = express();
  app.use(express.json());
  app.use(core.router);
  // for debugging failures
  // app.use(function(error: any, _req: any, _res: any, next: any) {
  //   console.log(error);
  //   next(error);
  // });
  server = createServer(app);
  const url = await listen(server);
  return {
    ...axios.create({ ...options, baseURL: url }),
    url,
  };
}

const getContext: ContextFactory<{
  getUser(): Promise<any>;
}> = (req: Request, knex: Knex) => {
  return {
    async getUser() {
      const { impersonate = undefined } = { ...req.headers, ...req.query };

      if (impersonate) {
        return await knex('test.users')
          .where('id', impersonate)
          .first();
      } else return null;
    },
  };
};

const knex = Knex({
  client: 'pg',
  connection: {
    database: process.env.USER,
  },
  ...knexHelpers,
});

beforeEach(async () => {
  await knex.raw(`
    drop schema if exists test cascade;
    create schema test;
  `);
});

afterEach(() => {
  if (server) {
    server?.close();
    server = null;
  }
});

afterAll(async () => {
  await knex.raw(`drop schema test cascade`);
  await knex.destroy();
});

it(`doesn't recreate the router`, () => {
  const core = Core(knex, getContext);
  expect(core.router).toBe(core.router);
});

it('reads tables', async () => {
  await knex.schema.withSchema('test').createTable('users', t => {
    t.bigIncrements('id').primary();
    t.string('email').unique();
  });

  const core = Core(knex, getContext);

  core.table({
    schemaName: 'test',
    tableName: 'users',
  });

  const { get } = await create(core);

  // read empty
  expect((await get('/test/users')).data).toStrictEqual({
    meta: {
      page: 0,
      limit: 50,
      hasMore: false,
      '@url': '/test/users',
      '@links': { count: '/test/users/count', ids: '/test/users/ids' },
    },
    data: [],
  });

  // read many
  for (let i = 0; i < 10; i++) {
    await knex('test.users').insert({
      email: `${i + 1}@abc.com`,
    });
  }

  expect((await get('/test/users')).data).toStrictEqual({
    meta: {
      page: 0,
      limit: 50,
      hasMore: false,
      '@url': '/test/users',
      '@links': { count: '/test/users/count', ids: '/test/users/ids' },
    },
    data: Array.from({ length: 10 }, (_, index) => ({
      '@links': {},
      '@url': `/test/users/${index + 1}`,
      id: index + 1,
      email: `${index + 1}@abc.com`,
    })),
  });

  // read paginated
  expect((await get('/test/users?limit=1&page=1')).data).toStrictEqual({
    meta: {
      page: 1,
      limit: 1,
      hasMore: true,
      '@url': '/test/users?limit=1&page=1',
      '@links': {
        count: '/test/users/count?limit=1&page=1',
        ids: '/test/users/ids?limit=1&page=1',
        nextPage: '/test/users?limit=1&page=2',
        previousPage: '/test/users?limit=1&page=0',
      },
    },
    data: [
      {
        '@links': {},
        '@url': `/test/users/2`,
        id: 2,
        email: `2@abc.com`,
      },
    ],
  });

  // check for keyset pagination link
  expect((await get('/test/users?limit=1')).data).toStrictEqual({
    meta: {
      page: 0,
      limit: 1,
      hasMore: true,
      '@url': '/test/users?limit=1',
      '@links': {
        count: '/test/users/count?limit=1',
        ids: '/test/users/ids?limit=1',
        nextPage: '/test/users?limit=1&lastId=1',
      },
    },
    data: [
      {
        '@links': {},
        '@url': `/test/users/1`,
        id: 1,
        email: `1@abc.com`,
      },
    ],
  });

  // use pagination link
  expect((await get('/test/users?limit=1&lastId=1')).data).toStrictEqual({
    meta: {
      page: 0,
      limit: 1,
      hasMore: true,
      '@url': '/test/users?limit=1&lastId=1',
      '@links': {
        ids: '/test/users/ids?limit=1&lastId=1',
        count: '/test/users/count?limit=1&lastId=1',
        nextPage: '/test/users?limit=1&lastId=2',
      },
    },
    data: [
      {
        '@links': {},
        '@url': `/test/users/2`,
        id: 2,
        email: `2@abc.com`,
      },
    ],
  });

  // read paginated (sorted)
  expect(
    (await get('/test/users?limit=1&page=1&sort=email.asc')).data
  ).toStrictEqual({
    meta: {
      page: 1,
      limit: 1,
      hasMore: true,
      '@url': '/test/users?limit=1&page=1&sort=email.asc',
      '@links': {
        ids: '/test/users/ids?limit=1&page=1&sort=email.asc',
        count: '/test/users/count?limit=1&page=1&sort=email.asc',
        nextPage: '/test/users?limit=1&page=2&sort=email.asc',
        previousPage: '/test/users?limit=1&page=0&sort=email.asc',
      },
    },
    data: [
      {
        '@links': {},
        '@url': `/test/users/1`,
        id: 1,
        email: `1@abc.com`,
      },
    ],
  });

  // read paginated by keyset (sorted)
  expect(
    (await get('/test/users?limit=1&lastId=1&sort=email')).data
  ).toStrictEqual({
    meta: {
      page: 0,
      limit: 1,
      hasMore: true,
      '@url': '/test/users?limit=1&lastId=1&sort=email',
      '@links': {
        count: '/test/users/count?limit=1&lastId=1&sort=email',
        ids: '/test/users/ids?limit=1&lastId=1&sort=email',
        nextPage: '/test/users?limit=1&lastId=2&sort=email',
      },
    },
    data: [
      {
        '@links': {},
        '@url': `/test/users/2`,
        id: 2,
        email: `2@abc.com`,
      },
    ],
  });

  // get by id
  expect((await get('/test/users/5')).data).toStrictEqual({
    data: {
      '@links': {},
      '@url': `/test/users/5`,
      id: 5,
      email: '5@abc.com',
    },
  });

  // get by query param
  expect((await get('/test/users?id=5')).data).toStrictEqual({
    meta: {
      page: 0,
      limit: 50,
      hasMore: false,
      '@url': '/test/users?id=5',
      '@links': {
        count: '/test/users/count?id=5',
        ids: '/test/users/ids?id=5',
      },
    },
    data: [
      {
        '@links': {},
        '@url': `/test/users/5`,
        id: 5,
        email: '5@abc.com',
      },
    ],
  });

  // Get a 404
  expect(await get('/test/users/11').catch(e => e.response.status)).toBe(404);

  // Get a count
  expect((await get('/test/users/count')).data).toStrictEqual({ data: 10 });
  expect((await get('/test/users/count?id=1')).data).toStrictEqual({
    data: 1,
  });

  for (let i = 10; i < 2000; i++) {
    await knex('test.users').insert({
      email: `${i + 1}@abc.com`,
    });
  }

  // get ids
  expect((await get('/test/users/ids?limit=1000')).data).toStrictEqual({
    meta: {
      '@links': {
        nextPage: '/test/users/ids?limit=1000&page=1',
      },
      '@url': '/test/users/ids?limit=1000',
      hasMore: true,
      page: 0,
      limit: 1000,
    },
    data: Array.from({ length: 1000 }).map((_, index) => index + 1),
  });

  expect((await get('/test/users/ids?page=1&limit=1000')).data).toStrictEqual({
    meta: {
      '@links': {
        nextPage: '/test/users/ids?page=2&limit=1000',
        previousPage: '/test/users/ids?page=0&limit=1000',
      },
      '@url': '/test/users/ids?page=1&limit=1000',
      hasMore: true,
      page: 1,
      limit: 1000,
    },
    data: Array.from({ length: 1000 }).map((_, index) => 1000 + index + 1),
  });
});

it('writes tables', async () => {
  await knex.schema.withSchema('test').createTable('users', t => {
    t.bigIncrements('id').primary();
    t.string('email')
      .notNullable()
      .unique();
  });

  for (let i = 0; i < 10; i++) {
    await knex('test.users').insert({
      email: `${i + 1}@abc.com`,
    });
  }

  const emitter = new EventEmitter();
  let events: ChangeSummary[] = [];
  emitter.on('change', event => events.push(event));

  const core = Core(knex, getContext, {
    emitter,
  });

  core.table({
    schemaName: 'test',
    tableName: 'users',
    schema: {
      email: string().email(),
    },
  });

  const { post, put, delete: del } = await create(core);

  // insert user
  expect(
    (
      await post('/test/users', {
        email: 'my-email-here@something.com',
      })
    ).data
  ).toStrictEqual({
    data: {
      '@links': {},
      '@url': '/test/users/11',
      email: 'my-email-here@something.com',
      id: 11,
    },
  });

  expect(events.length).toBe(1);
  expect(events[0].mode).toBe('insert');
  events = [];

  // insert duplicate user
  expect(
    (
      await post('/test/users', {
        email: 'my-email-here@something.com',
      }).catch(e => e.response)
    ).data
  ).toStrictEqual({ errors: { email: 'is already in use' } });

  expect(events.length).toBe(0);
  events = [];

  // update that user
  expect(
    (
      await put('/test/users/11', {
        email: 'updated@email.com',
      })
    ).data
  ).toStrictEqual({
    data: {
      '@links': {},
      '@url': '/test/users/11',
      email: 'updated@email.com',
      id: 11,
    },
  });

  expect(events.length).toBe(1);
  expect(events[0].mode).toBe('update');
  events = [];

  // update that user (to the same values, which doesn't trigger another sql update)
  expect(
    (
      await put('/test/users/11', {
        email: 'updated@email.com',
      })
    ).data
  ).toStrictEqual({
    data: {
      '@links': {},
      '@url': '/test/users/11',
      email: 'updated@email.com',
      id: 11,
    },
  });

  // delete that user
  expect((await del('/test/users/11')).data).toStrictEqual({
    data: null,
  });

  expect(events.length).toBe(1);
  expect(events[0].mode).toBe('delete');
  events = [];

  // insert bad email user
  expect(
    (
      await post('/test/users', {
        email: 'abc',
      }).catch(e => e.response)
    ).data
  ).toStrictEqual({ errors: { email: 'must be a valid email' } });

  // insert without email
  expect(
    (await post('/test/users', { email: null }).catch(e => e.response)).data
  ).toStrictEqual({ errors: { email: 'is required' } });
});

it('handles relations', async () => {
  await knex.schema.withSchema('test').createTable('users', t => {
    t.bigIncrements('id').primary();
    t.string('email')
      .notNullable()
      .unique();
  });

  await knex.schema.withSchema('test').createTable('comments', t => {
    t.bigIncrements('id').primary();
    t.bigInteger('user_id').notNullable();
    t.string('body').notNullable();
    t.foreign('user_id')
      .references('id')
      .inTable('test.users');
  });

  for (let i = 0; i < 10; i++) {
    await knex('test.users').insert({
      email: `${i + 1}@abc.com`,
    });

    await knex('test.comments').insert({
      body: String(i),
      userId: '1',
    });
  }

  const emitter = new EventEmitter();
  let events: ChangeSummary[] = [];
  emitter.on('change', event => events.push(event));

  const core = Core(knex, getContext, {
    emitter,
  });

  core.table({
    schemaName: 'test',
    tableName: 'users',
    schema: {
      email: string().email(),
    },
    idModifiers: {
      me: async (query: QueryBuilder, { getUser }) => {
        const user = await getUser();
        query.where('users.id', user.id);
      },
    },
    async policy(query: QueryBuilder, { getUser }) {
      const user = await getUser();
      if (!user) return;
      query.where('users.id', user.id);
    },
  });

  core.table({
    schemaName: 'test',
    tableName: 'comments',
    tenantIdColumnName: 'userId',
    queryModifiers: {
      mine: async (_: string, query: QueryBuilder, { getUser }) => {
        const user = await getUser();
        query.where('comments.userId', user.id);
      },
    },
    async policy(query: QueryBuilder, { getUser }) {
      const user = await getUser();
      if (!user) return;
      query.where('comments.userId', user.id);
    },
  });

  const { get, post, put, delete: del } = await create(core, {
    headers: {
      impersonate: '1',
    },
  });

  expect((await get('/test/users/me')).data).toStrictEqual({
    data: {
      '@links': {
        comments: '/test/comments?userId=1',
      },
      '@url': '/test/users/1',
      email: '1@abc.com',
      id: 1,
    },
  });

  expect((await get('/test/users?id=me')).data).toStrictEqual({
    meta: {
      page: 0,
      limit: 50,
      hasMore: false,
      '@url': '/test/users?id=me',
      '@links': {
        count: '/test/users/count?id=me',
        ids: '/test/users/ids?id=me',
      },
    },
    data: [
      {
        '@links': {
          comments: '/test/comments?userId=1',
        },
        '@url': '/test/users/1',
        email: '1@abc.com',
        id: 1,
      },
    ],
  });

  expect(
    (await get('/test/comments?userId=1&include=user')).data
  ).toStrictEqual({
    meta: {
      page: 0,
      limit: 50,
      hasMore: false,
      '@url': '/test/comments?userId=1&include=user',
      '@links': {
        count: '/test/comments/count?userId=1&include=user',
        ids: '/test/comments/ids?userId=1&include=user',
      },
    },
    data: Array.from({ length: 10 }, (_, index) => ({
      '@links': {},
      '@url': `/test/comments/${index + 1}`,
      id: index + 1,
      userId: 1,
      body: String(index),
      user: {
        '@links': {
          comments: '/test/comments?userId=1',
        },
        '@url': '/test/users/1',
        email: '1@abc.com',
        id: 1,
      },
    })),
  });

  expect((await get('/test/comments?mine&include=user')).data).toStrictEqual({
    meta: {
      page: 0,
      limit: 50,
      hasMore: false,
      '@url': '/test/comments?mine&include=user',
      '@links': {
        count: '/test/comments/count?mine=&include=user',
        ids: '/test/comments/ids?mine=&include=user',
      },
    },
    data: Array.from({ length: 10 }, (_, index) => ({
      '@links': {},
      '@url': `/test/comments/${index + 1}`,
      id: index + 1,
      userId: 1,
      body: String(index),
      user: {
        '@links': {
          comments: '/test/comments?userId=1',
        },
        '@url': '/test/users/1',
        email: '1@abc.com',
        id: 1,
      },
    })),
  });

  expect((await get('/test/comments?userId=1')).data).toStrictEqual({
    meta: {
      page: 0,
      limit: 50,
      hasMore: false,
      '@url': '/test/comments?userId=1',
      '@links': {
        count: '/test/comments/count?userId=1',
        ids: '/test/comments/ids?userId=1',
      },
    },
    data: Array.from({ length: 10 }, (_, index) => ({
      '@links': {
        user: `/test/users/1`,
      },
      '@url': `/test/comments/${index + 1}`,
      id: index + 1,
      userId: 1,
      body: String(index),
    })),
  });

  expect((await get('/test/users')).data).toStrictEqual({
    meta: {
      page: 0,
      limit: 50,
      hasMore: false,
      '@url': '/test/users',
      '@links': { count: '/test/users/count', ids: '/test/users/ids' },
    },
    data: [
      {
        '@links': {
          comments: `/test/comments?userId=1`,
        },
        '@url': `/test/users/1`,
        id: 1,
        email: `1@abc.com`,
      },
    ],
  });

  // create from has many
  expect(
    (
      await post(
        '/test/users',
        {
          email: 'thing@email.com',
          comments: [
            {
              body: 'hey',
            },
            {
              body: '123',
            },
          ],
        },
        {
          headers: {
            impersonate: '',
          },
        }
      )
    ).data
  ).toStrictEqual({
    data: {
      '@links': {
        comments: '/test/comments?userId=11',
      },
      '@url': '/test/users/11',
      comments: [
        {
          '@links': {
            user: '/test/users/11',
          },
          '@url': '/test/comments/11',
          body: 'hey',
          id: 11,
          userId: 11,
        },
        {
          '@links': {
            user: '/test/users/11',
          },
          '@url': '/test/comments/12',
          body: '123',
          id: 12,
          userId: 11,
        },
      ],
      email: 'thing@email.com',
      id: 11,
    },
  });

  expect(events.length).toBe(3);
  expect(events[0].mode).toBe('insert');
  expect(events[1].mode).toBe('insert');
  expect(events[2].mode).toBe('insert');
  events = [];

  // create from has one
  expect(
    (
      await post(
        '/test/comments',
        {
          body: 'body',
          user: {
            email: 'another-email@email.com',
          },
        },
        {
          headers: {
            impersonate: '',
          },
        }
      )
    ).data
  ).toStrictEqual({
    data: {
      '@links': {},
      '@url': '/test/comments/13',
      body: 'body',
      id: 13,
      user: {
        '@links': {
          comments: '/test/comments?userId=12',
        },
        '@url': '/test/users/12',
        email: 'another-email@email.com',
        id: 12,
      },
      userId: 12,
    },
  });

  expect(events.length).toBe(2);
  expect(events[0].mode).toBe('insert');
  expect(events[1].mode).toBe('insert');
  events = [];

  // create from has one but with a validation error
  expect(
    (
      await post(
        '/test/comments',
        {
          body: 'body',
          user: {
            email: 'another-email@email.com',
          },
        },
        {
          headers: {
            impersonate: '',
          },
        }
      ).catch(e => e.response)
    ).data
  ).toStrictEqual({
    errors: {
      user: { email: 'is already in use' },
    },
  });

  expect(events.length).toBe(0);
  events = [];

  // create from has many with a validation error
  expect(
    (
      await post(
        '/test/users',
        {
          email: 'another-email-for-another-test@email.com',
          comments: [
            {
              body: null,
            },
            {
              body: null,
            },
          ],
        },
        {
          headers: {
            impersonate: '',
          },
        }
      ).catch(e => e.response)
    ).data
  ).toStrictEqual({
    errors: {
      comments: [
        {
          body: 'is required',
        },
        {
          body: 'is required',
        },
      ],
    },
  });

  // cannot create outside this user's policy
  expect(
    (
      await post('/test/comments', {
        body: 'hey',
        userId: 2,
      }).catch(e => {
        return e.response;
      })
    ).status
  ).toStrictEqual(401);

  expect(events.length).toBe(0);
  events = [];

  const [newCommentId] = await knex('test.comments')
    .insert({
      body: 'body',
      userId: 2,
    })
    .returning('id');

  notifyChange(emitter, {
    mode: 'insert',
    schemaName: 'test',
    tableName: 'comments',
    row: { id: newCommentId },
  });

  expect(events.length).toBe(1);
  events = [];

  // cannot edit outside this user's policy
  expect(
    (
      await put(`/test/comments/${newCommentId}`, {
        body: 'hey',
        userId: 2,
      }).catch(e => {
        return e.response;
      })
    ).status
  ).toStrictEqual(401);

  // cannot change an item to be outside this user's policy
  expect(
    (
      await put(`/test/comments/1`, {
        userId: 2,
      }).catch(e => {
        return e.response;
      })
    ).status
  ).toStrictEqual(401);

  // cannot edit outside this user's policy
  expect(
    (
      await del(`/test/comments/${newCommentId}?userId=2`).catch(e => {
        return e.response;
      })
    ).status
  ).toStrictEqual(401);
});

it('reflects endpoints from the database', async () => {
  await knex.schema.withSchema('test').createTable('users', t => {
    t.bigIncrements('id').primary();
    t.string('email')
      .notNullable()
      .unique();
  });

  await knex.schema.withSchema('test').createTable('comments', t => {
    t.bigIncrements('id').primary();
    t.bigInteger('user_id').notNullable();
    t.string('body').notNullable();
    t.foreign('user_id')
      .references('id')
      .inTable('test.users');
  });

  for (let i = 0; i < 10; i++) {
    await knex('test.users').insert({
      email: `${i + 1}@abc.com`,
    });

    await knex('test.comments').insert({
      body: String(i),
      userId: '1',
    });
  }

  const core = Core(knex, getContext);

  core.table({
    schemaName: 'test',
    tableName: 'users',
    schema: {
      email: string().email(),
    },
    idModifiers: {
      me: async (query, { getUser }) => {
        const user = await getUser();
        query.where('users.id', user.id);
      },
    },
    async policy(query: QueryBuilder, { getUser }) {
      const user = await getUser();
      if (!user) return;
      query.where('users.id', user.id);
    },
  });

  core.table({
    schemaName: 'test',
    tableName: 'comments',
    tenantIdColumnName: 'userId',
    queryModifiers: {
      mine: async (_, query, { getUser }) => {
        const user = await getUser();
        query.where('comments.userId', user.id);
      },
    },
    async policy(query: QueryBuilder, { getUser }) {
      const user = await getUser();
      if (!user) return;
      query.where('comments.userId', user.id);
    },
  });

  const { get } = await create(core, {
    headers: {
      impersonate: '1',
    },
  });

  const { data } = await get('/test/users');

  expect(data).toEqual({
    meta: {
      page: 0,
      limit: 50,
      hasMore: false,
      '@url': '/test/users',
      '@links': {
        count: '/test/users/count',
        ids: '/test/users/ids',
      },
    },
    data: [
      {
        id: 1,
        email: '1@abc.com',
        '@url': '/test/users/1',
        '@links': {
          comments: '/test/comments?userId=1',
        },
      },
    ],
  });
});

it('supports plugins like withTimestamp', async () => {
  await knex.schema.withSchema('test').createTable('users', t => {
    t.bigIncrements('id').primary();
    t.string('email')
      .notNullable()
      .unique();
  });

  await knex.schema.withSchema('test').createTable('comments', t => {
    t.bigIncrements('id').primary();
    t.bigInteger('user_id').notNullable();
    t.string('body').notNullable();
    t.timestamps(true, true);
    t.foreign('user_id')
      .references('id')
      .inTable('test.users');
  });

  for (let i = 0; i < 2; i++) {
    await knex('test.users').insert({
      email: `${i + 1}@abc.com`,
    });

    const date = new Date('May 1, 2020');

    await knex('test.comments').insert({
      body: String(i),
      userId: '1',
      updatedAt: date,
      createdAt: date,
    });
  }

  const core = Core(knex, getContext);

  core.table({
    schemaName: 'test',
    tableName: 'users',
    schema: {
      email: string().email(),
    },
    idModifiers: {
      me: async (query, { getUser }) => {
        const user = await getUser();
        query.where('users.id', user.id);
      },
    },
    async policy(query: QueryBuilder, { getUser }) {
      const user = await getUser();
      if (!user) return;
      query.where('users.id', user.id);
    },
  });

  core.table(
    withTimestamps({
      schemaName: 'test',
      tableName: 'comments',
      tenantIdColumnName: 'userId',
      queryModifiers: {
        mine: async (_, query, { getUser }) => {
          const user = await getUser();
          query.where('comments.userId', user.id);
        },
      },
      async policy(query: QueryBuilder, { getUser }) {
        const user = await getUser();
        if (!user) return;
        query.where('comments.userId', user.id);
      },
    })
  );

  const { get, put } = await create(core, {
    headers: {
      impersonate: '1',
    },
  });

  let { data } = await get('/test/comments');

  expect(data).toEqual({
    data: [
      {
        '@links': {
          user: '/test/users/1',
        },
        '@url': '/test/comments/1',
        body: '0',
        createdAt: '2020-05-01T06:00:00.000Z',
        id: 1,
        updatedAt: '2020-05-01T06:00:00.000Z',
        userId: 1,
      },
      {
        '@links': {
          user: '/test/users/1',
        },
        '@url': '/test/comments/2',
        body: '1',
        createdAt: '2020-05-01T06:00:00.000Z',
        id: 2,
        updatedAt: '2020-05-01T06:00:00.000Z',
        userId: 1,
      },
    ],
    meta: {
      '@links': {
        count: '/test/comments/count',
        ids: '/test/comments/ids',
      },
      '@url': '/test/comments',
      hasMore: false,
      page: 0,
      limit: 50,
    },
  });

  // since works
  expect(
    (await get(`/test/comments?since=${encodeURIComponent('may 2, 2020')}`))
      .data
  ).toEqual({
    data: [],
    meta: {
      '@links': {
        count: '/test/comments/count?since=may%202%2C%202020',
        ids: '/test/comments/ids?since=may%202%2C%202020',
      },
      '@url': '/test/comments?since=may%202%2C%202020',
      hasMore: false,
      page: 0,
      limit: 50,
    },
  });

  // make sure updatedAt is updated
  const beforeUpdate = (await get('/test/comments/1')).data.data;

  await put(`/test/comments/1`, {
    body: 'hey',
    userId: 1,
  });

  const afterUpdate = (await get('/test/comments/1')).data.data;

  expect(beforeUpdate.createdAt).toEqual(afterUpdate.createdAt);
  expect(beforeUpdate.updatedAt).not.toEqual(afterUpdate.updatedAt);
});

it('supports paranoid', async () => {
  await knex.schema.withSchema('test').createTable('users', t => {
    t.bigIncrements('id').primary();
    t.string('email')
      .notNullable()
      .unique();
    t.timestamps(true, true);
    t.timestamp('deleted_at', { useTz: true });
  });

  await knex.schema.withSchema('test').createTable('comments', t => {
    t.bigIncrements('id').primary();
    t.bigInteger('user_id').notNullable();
    t.string('body').notNullable();
    t.timestamps(true, true);
    t.timestamp('deleted_at', { useTz: true });
    t.foreign('user_id')
      .references('id')
      .inTable('test.users');
  });

  for (let i = 0; i < 2; i++) {
    await knex('test.users').insert({
      email: `${i + 1}@abc.com`,
    });

    const date = new Date('May 1, 2020');

    await knex('test.comments').insert({
      body: String(i),
      userId: '1',
      updatedAt: date,
      createdAt: date,
    });
  }

  const core = Core(knex, getContext);

  core.table({
    schemaName: 'test',
    tableName: 'users',
    paranoid: true,
    schema: {
      email: string().email(),
    },
    idModifiers: {
      me: async (query, { getUser }) => {
        const user = await getUser();
        query.where('users.id', user.id);
      },
    },
    async policy(query: QueryBuilder, { getUser }) {
      const user = await getUser();
      if (!user) return;
      query.where('users.id', user.id);
    },
  });

  core.table(
    withTimestamps({
      schemaName: 'test',
      tableName: 'comments',
      paranoid: true,
      tenantIdColumnName: 'userId',
      queryModifiers: {
        mine: async (_, query, { getUser }) => {
          const user = await getUser();
          query.where('comments.userId', user.id);
        },
      },
      async policy(query: QueryBuilder, { getUser }) {
        const user = await getUser();
        if (!user) return;
        query.where('comments.userId', user.id);
      },
    })
  );

  const { get, delete: del } = await create(core, {
    headers: {
      impersonate: '1',
    },
  });

  let { data } = await get('/test/comments');

  expect(data).toEqual({
    data: [
      {
        '@links': {
          user: '/test/users/1',
        },
        '@url': '/test/comments/1',
        body: '0',
        createdAt: '2020-05-01T06:00:00.000Z',
        deletedAt: null,
        id: 1,
        updatedAt: '2020-05-01T06:00:00.000Z',
        userId: 1,
      },
      {
        '@links': {
          user: '/test/users/1',
        },
        '@url': '/test/comments/2',
        body: '1',
        createdAt: '2020-05-01T06:00:00.000Z',
        deletedAt: null,
        id: 2,
        updatedAt: '2020-05-01T06:00:00.000Z',
        userId: 1,
      },
    ],
    meta: {
      '@links': {
        count: '/test/comments/count',
        ids: '/test/comments/ids',
      },
      '@url': '/test/comments',
      hasMore: false,
      page: 0,
      limit: 50,
    },
  });

  // make sure updatedAt is updated
  const beforeUpdate = (await get('/test/comments/1')).data.data;

  await del(`/test/comments/1?userId=1`);

  const afterUpdate = (await get('/test/comments/1')).data.data;

  expect(beforeUpdate.deletedAt).toEqual(null);
  expect(beforeUpdate.deletedAt).not.toEqual(afterUpdate.deletedAt);

  let { data: afterData } = await get('/test/comments');
  expect(afterData).toEqual({
    data: [
      {
        '@links': {
          user: '/test/users/1',
        },
        '@url': '/test/comments/2',
        body: '1',
        createdAt: '2020-05-01T06:00:00.000Z',
        deletedAt: null,
        id: 2,
        updatedAt: '2020-05-01T06:00:00.000Z',
        userId: 1,
      },
    ],
    meta: {
      '@links': {
        count: '/test/comments/count',
        ids: '/test/comments/ids',
      },
      '@url': '/test/comments',
      hasMore: false,
      page: 0,
      limit: 50,
    },
  });

  // make sure passing withDeleted gives the row
  let { data: afterDataWithDeleted } = await get(
    '/test/comments?withDeleted=true'
  );
  expect(afterDataWithDeleted.data.length).toEqual(2);

  await del('/test/users/1?userId=1');

  const comments = await knex('test.comments');

  expect(comments.every(comment => comment.deletedAt !== null)).toBe(true);
});
