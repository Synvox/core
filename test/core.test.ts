import { createServer } from 'http';
import path from 'path';
import { promises as fs } from 'fs';
import { EventEmitter } from 'events';
import express, { Request, Application } from 'express';
import axios, { AxiosRequestConfig } from 'axios';
import listen from 'test-listen';
import EventSource from 'eventsource';
import Knex, { QueryBuilder } from 'knex';
import { string } from 'yup';
import Core, {
  knexHelpers,
  ContextFactory,
  notifyChange,
  withTimestamps,
  ChangeSummary,
} from '../src';

let server: null | ReturnType<typeof createServer> = null;

async function create(
  core: any,
  options?: Partial<AxiosRequestConfig>,
  middlewareHook?: (app: Application) => void
) {
  if (server) {
    server?.close();
    server = null;
  }

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

const getContext: ContextFactory<{
  getUser(): Promise<any>;
}> = (req: Request) => {
  let user: any = null;
  return {
    async getUser() {
      if (user) return user;
      const { impersonate = undefined } = { ...req.headers, ...req.query };

      if (impersonate) {
        user = await knex('test.users')
          .where('users.id', impersonate)
          .first();
        return user;
      } else return null;
    },
  };
};

let queries: string[] = [];
const lastQuery = () => queries[queries.length - 1];
const clearQueries = () => (queries = []);

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
  await knex.raw(`
    drop schema if exists test cascade;
    create schema test;
    drop table if exists public.test_table;
  `);
});

afterEach(() => {
  clearQueries();
  if (server) {
    server?.close();
    server = null;
  }
});

afterAll(async () => {
  await knex.raw(`drop schema test cascade`);
  await knex.destroy();
});

it('reads tables', async () => {
  await knex.schema.withSchema('test').createTable('users', t => {
    t.bigIncrements('id').primary();
    t.string('email').unique();
    t.string('hidden');
  });

  const core = Core(knex, getContext);

  core.table({
    schemaName: 'test',
    tableName: 'users',
    hiddenColumns: ['hidden'],
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

  // adding tables after the first request throws
  expect(() => {
    core.table({ tableName: 'derp' });
  }).toThrow();

  // read many
  for (let i = 0; i < 10; i++) {
    await knex('test.users').insert({
      email: `${i + 1}@abc.com`,
      hidden: 'abc123',
    });
  }

  clearQueries();
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
  expect(queries.length).toBe(1);
  expect(lastQuery()).toBe(
    'select users.* from test.users order by users.id asc limit ?'
  );

  // read paginated
  clearQueries();
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
  expect(queries.length).toBe(1);
  expect(lastQuery()).toBe(
    'select users.* from test.users order by users.id asc limit ? offset ?'
  );

  // check for keyset pagination link
  clearQueries();
  expect((await get('/test/users?limit=1')).data).toMatchInlineSnapshot(`
    Object {
      "data": Array [
        Object {
          "@links": Object {},
          "@url": "/test/users/1",
          "email": "1@abc.com",
          "id": 1,
        },
      ],
      "meta": Object {
        "@links": Object {
          "count": "/test/users/count?limit=1",
          "ids": "/test/users/ids?limit=1",
          "nextPage": "/test/users?limit=1&cursor=eyJpZCI6MSwiZW1haWwiOiIxQGFiYy5jb20iLCJoaWRkZW4iOiJhYmMxMjMifQ%3D%3D",
        },
        "@url": "/test/users?limit=1",
        "hasMore": true,
        "limit": 1,
        "page": 0,
      },
    }
  `);
  expect(queries.length).toBe(1);
  expect(lastQuery()).toBe(
    'select users.* from test.users order by users.id asc limit ?'
  );

  // use pagination link
  clearQueries();
  expect(
    (
      await get(
        '/test/users?limit=1&cursor=eyJpZCI6MSwiZW1haWwiOiIxQGFiYy5jb20iLCJoaWRkZW4iOiJhYmMxMjMifQ%3D%3D'
      )
    ).data
  ).toMatchInlineSnapshot(`
    Object {
      "data": Array [
        Object {
          "@links": Object {},
          "@url": "/test/users/2",
          "email": "2@abc.com",
          "id": 2,
        },
      ],
      "meta": Object {
        "@links": Object {
          "count": "/test/users/count?limit=1&cursor=eyJpZCI6MSwiZW1haWwiOiIxQGFiYy5jb20iLCJoaWRkZW4iOiJhYmMxMjMifQ%3D%3D",
          "ids": "/test/users/ids?limit=1&cursor=eyJpZCI6MSwiZW1haWwiOiIxQGFiYy5jb20iLCJoaWRkZW4iOiJhYmMxMjMifQ%3D%3D",
          "nextPage": "/test/users?limit=1&cursor=eyJpZCI6MiwiZW1haWwiOiIyQGFiYy5jb20iLCJoaWRkZW4iOiJhYmMxMjMifQ%3D%3D",
        },
        "@url": "/test/users?limit=1&cursor=eyJpZCI6MSwiZW1haWwiOiIxQGFiYy5jb20iLCJoaWRkZW4iOiJhYmMxMjMifQ%3D%3D",
        "hasMore": true,
        "limit": 1,
        "page": 0,
      },
    }
  `);
  expect(queries.length).toBe(1);
  expect(lastQuery()).toBe(
    'select users.* from test.users where ((users.id > ?)) order by users.id asc limit ?'
  );

  // read paginated (sorted)
  clearQueries();
  expect(
    (await get('/test/users?limit=1&page=1&sort=email')).data
  ).toStrictEqual({
    meta: {
      page: 1,
      limit: 1,
      hasMore: true,
      '@url': '/test/users?limit=1&page=1&sort=email',
      '@links': {
        ids: '/test/users/ids?limit=1&page=1&sort=email',
        count: '/test/users/count?limit=1&page=1&sort=email',
        nextPage: '/test/users?limit=1&page=2&sort=email',
        previousPage: '/test/users?limit=1&page=0&sort=email',
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
  expect(queries.length).toBe(1);
  expect(lastQuery()).toBe(
    'select users.* from test.users order by users.email asc limit ? offset ?'
  );

  clearQueries();
  expect(
    (await get('/test/users?limit=1&page=1&sort=-email')).data
  ).toStrictEqual({
    meta: {
      page: 1,
      limit: 1,
      hasMore: true,
      '@url': '/test/users?limit=1&page=1&sort=-email',
      '@links': {
        ids: '/test/users/ids?limit=1&page=1&sort=-email',
        count: '/test/users/count?limit=1&page=1&sort=-email',
        nextPage: '/test/users?limit=1&page=2&sort=-email',
        previousPage: '/test/users?limit=1&page=0&sort=-email',
      },
    },
    data: [
      {
        '@links': {},
        '@url': `/test/users/8`,
        id: 8,
        email: `8@abc.com`,
      },
    ],
  });
  expect(queries.length).toBe(1);
  expect(lastQuery()).toBe(
    'select users.* from test.users order by users.email desc limit ? offset ?'
  );

  clearQueries();
  expect(
    (await get('/test/users?limit=1&page=1&sort[]=-email&sort[]=id')).data
  ).toStrictEqual({
    meta: {
      page: 1,
      limit: 1,
      hasMore: true,
      '@url': '/test/users?limit=1&page=1&sort[]=-email&sort[]=id',
      '@links': {
        ids: '/test/users/ids?limit=1&page=1&sort[]=-email&sort[]=id',
        count: '/test/users/count?limit=1&page=1&sort[]=-email&sort[]=id',
        nextPage: '/test/users?limit=1&page=2&sort[]=-email&sort[]=id',
        previousPage: '/test/users?limit=1&page=0&sort[]=-email&sort[]=id',
      },
    },
    data: [
      {
        '@links': {},
        '@url': `/test/users/8`,
        id: 8,
        email: `8@abc.com`,
      },
    ],
  });
  expect(queries.length).toBe(1);
  expect(lastQuery()).toBe(
    'select users.* from test.users order by users.email desc, users.id asc limit ? offset ?'
  );

  // read paginated by keyset (sorted)
  clearQueries();
  expect(
    (
      await get(
        '/test/users?limit=1&sort=email&cursor=eyJpZCI6MSwiZW1haWwiOiIxQGFiYy5jb20iLCJoaWRkZW4iOiJhYmMxMjMifQ%3D%3D'
      )
    ).data
  ).toMatchInlineSnapshot(`
    Object {
      "data": Array [
        Object {
          "@links": Object {},
          "@url": "/test/users/2",
          "email": "2@abc.com",
          "id": 2,
        },
      ],
      "meta": Object {
        "@links": Object {
          "count": "/test/users/count?limit=1&sort=email&cursor=eyJpZCI6MSwiZW1haWwiOiIxQGFiYy5jb20iLCJoaWRkZW4iOiJhYmMxMjMifQ%3D%3D",
          "ids": "/test/users/ids?limit=1&sort=email&cursor=eyJpZCI6MSwiZW1haWwiOiIxQGFiYy5jb20iLCJoaWRkZW4iOiJhYmMxMjMifQ%3D%3D",
          "nextPage": "/test/users?limit=1&sort=email&cursor=eyJpZCI6MiwiZW1haWwiOiIyQGFiYy5jb20iLCJoaWRkZW4iOiJhYmMxMjMifQ%3D%3D",
        },
        "@url": "/test/users?limit=1&sort=email&cursor=eyJpZCI6MSwiZW1haWwiOiIxQGFiYy5jb20iLCJoaWRkZW4iOiJhYmMxMjMifQ%3D%3D",
        "hasMore": true,
        "limit": 1,
        "page": 0,
      },
    }
  `);
  expect(queries.length).toBe(1);
  expect(lastQuery()).toBe(
    'select users.* from test.users where ((users.email > ?)) order by users.email asc limit ?'
  );

  // read paginated by keyset (sorted)
  clearQueries();
  expect(
    (
      await get(
        '/test/users?limit=1&sort[]=email&sort[]=-id&cursor=eyJpZCI6MSwiZW1haWwiOiIxQGFiYy5jb20iLCJoaWRkZW4iOiJhYmMxMjMifQ%3D%3D'
      )
    ).data
  ).toMatchInlineSnapshot(`
    Object {
      "data": Array [
        Object {
          "@links": Object {},
          "@url": "/test/users/2",
          "email": "2@abc.com",
          "id": 2,
        },
      ],
      "meta": Object {
        "@links": Object {
          "count": "/test/users/count?limit=1&sort[]=email&sort[]=-id&cursor=eyJpZCI6MSwiZW1haWwiOiIxQGFiYy5jb20iLCJoaWRkZW4iOiJhYmMxMjMifQ%3D%3D",
          "ids": "/test/users/ids?limit=1&sort[]=email&sort[]=-id&cursor=eyJpZCI6MSwiZW1haWwiOiIxQGFiYy5jb20iLCJoaWRkZW4iOiJhYmMxMjMifQ%3D%3D",
          "nextPage": "/test/users?limit=1&sort[]=email&sort[]=-id&cursor=eyJpZCI6MiwiZW1haWwiOiIyQGFiYy5jb20iLCJoaWRkZW4iOiJhYmMxMjMifQ%3D%3D",
        },
        "@url": "/test/users?limit=1&sort[]=email&sort[]=-id&cursor=eyJpZCI6MSwiZW1haWwiOiIxQGFiYy5jb20iLCJoaWRkZW4iOiJhYmMxMjMifQ%3D%3D",
        "hasMore": true,
        "limit": 1,
        "page": 0,
      },
    }
  `);
  expect(queries.length).toBe(1);
  expect(lastQuery()).toBe(
    'select users.* from test.users where ((users.email > ?) or (users.email = ? and users.id < ?)) order by users.email asc, users.id desc limit ?'
  );

  // get by id
  clearQueries();
  expect((await get('/test/users/5')).data).toStrictEqual({
    data: {
      '@links': {},
      '@url': `/test/users/5`,
      id: 5,
      email: '5@abc.com',
    },
  });
  expect(queries.length).toBe(1);
  expect(lastQuery()).toBe(
    'select users.* from test.users where users.id = ? limit ?'
  );

  // get by query param
  clearQueries();
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
  expect(queries.length).toBe(1);
  expect(lastQuery()).toBe(
    'select users.* from test.users where users.id = ? order by users.id asc limit ?'
  );

  // Get a 404
  clearQueries();
  expect(await get('/test/users/11').catch(e => e.response.status)).toBe(404);
  expect(queries.length).toBe(1);
  expect(lastQuery()).toBe(
    'select users.* from test.users where users.id = ? limit ?'
  );

  clearQueries();
  // Get a count
  expect((await get('/test/users/count')).data).toStrictEqual({ data: 10 });

  expect(queries.length).toBe(1);
  expect(lastQuery()).toBe('select count(distinct users.id) from test.users');
  clearQueries();

  expect((await get('/test/users/count?id=1')).data).toStrictEqual({
    data: 1,
  });

  await knex.raw(`
    insert into test.users (email)
    select i from generate_series(1, 2000) as t(i)
  `);

  clearQueries();

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

  expect(queries.length).toBe(1);
  expect(lastQuery()).toBe('select users.id from test.users limit ?');
  clearQueries();

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

  expect(lastQuery()).toBe('select users.id from test.users limit ? offset ?');
});

it('writes tables', async () => {
  await knex.schema.withSchema('test').createTable('users', t => {
    t.bigIncrements('id').primary();
    t.string('email')
      .notNullable()
      .unique();
    t.string('readonly').defaultTo('static');
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
    readOnlyColumns: ['readonly'],
  });

  const { get, post, put, delete: del } = await create(core);

  await get('/test/users');

  // insert user
  clearQueries();
  expect(
    (
      await post('/test/users', {
        email: 'my-email-here@something.com',
        readonly: 'derp',
      })
    ).data
  ).toStrictEqual({
    data: {
      '@links': {},
      '@url': '/test/users/11',
      email: 'my-email-here@something.com',
      readonly: 'static',
      id: 11,
    },
  });
  expect(queries.length).toBe(3);
  expect(queries).toStrictEqual([
    'select users.* from test.users where users.email = ? limit ?',
    'insert into test.users (email) values (?) returning *',
    'select users.* from test.users where users.id = ? limit ?',
  ]);

  expect(events.length).toBe(1);
  expect(events[0].mode).toBe('insert');
  events = [];

  // insert duplicate user
  clearQueries();
  expect(
    (
      await post('/test/users', {
        email: 'my-email-here@something.com',
      }).catch(e => e.response)
    ).data
  ).toStrictEqual({ errors: { email: 'is already in use' } });
  expect(queries.length).toBe(1);
  expect(lastQuery()).toBe(
    'select users.* from test.users where users.email = ? limit ?'
  );

  expect(events.length).toBe(0);
  events = [];

  // update that user
  clearQueries();
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
      readonly: 'static',
    },
  });
  expect(queries.length).toBe(5);
  expect(queries).toStrictEqual([
    'select users.* from test.users where users.id = ? limit ?', // get row
    'select users.* from test.users where not (users.id = ?) and users.email = ? limit ?', // get possible duplicates
    'select users.* from test.users where users.id = ? limit ?', // get row (in transaction)
    'update test.users set email = ? where users.id = ?', // update
    'select users.* from test.users where users.id = ? limit ?', // make sure row is still editable
  ]);

  expect(events.length).toBe(1);
  expect(events[0].mode).toBe('update');
  events = [];

  // update that user (to the same values, which doesn't trigger another sql update)
  clearQueries();
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
      readonly: 'static',
    },
  });
  expect(queries).toStrictEqual([
    'select users.* from test.users where users.id = ? limit ?',
    'select users.* from test.users where not (users.id = ?) and users.email = ? limit ?', // check for duplicate
    'select users.* from test.users where users.id = ? limit ?', // get in transaction
    // abort because nothing actually changed
  ]);
  expect(queries.length).toBe(3);

  // delete that user
  clearQueries();
  expect((await del('/test/users/11')).data).toStrictEqual({
    data: null,
  });
  expect(queries).toStrictEqual([
    'select users.* from test.users where users.id = ? limit ?',
    'delete from test.users where users.id = ?',
  ]);
  expect(queries.length).toBe(2);

  expect(events.length).toBe(1);
  expect(events[0].mode).toBe('delete');
  events = [];

  // insert bad email user
  clearQueries();
  expect(
    (
      await post('/test/users', {
        email: 'abc',
      }).catch(e => e.response)
    ).data
  ).toStrictEqual({ errors: { email: 'must be a valid email' } });
  expect(events.length).toBe(0);

  // insert without email
  clearQueries();
  expect(
    (await post('/test/users', { email: null }).catch(e => e.response)).data
  ).toStrictEqual({ errors: { email: 'is required' } });
  expect(events.length).toBe(0);
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

  clearQueries();
  expect(
    (await get('/test/comments?userId=1&include[]=user&include[]=notHere')).data
  ).toStrictEqual({
    meta: {
      page: 0,
      limit: 50,
      hasMore: false,
      '@url': '/test/comments?userId=1&include[]=user&include[]=notHere',
      '@links': {
        count: '/test/comments/count?userId=1&include[]=user&include[]=notHere',
        ids: '/test/comments/ids?userId=1&include[]=user&include[]=notHere',
      },
    },
    data: Array.from({ length: 10 }, (_, index) => ({
      '@links': {},
      '@url': `/test/comments/${index + 1}?userId=1`,
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
  expect(queries).toEqual([
    'select * from test.users where users.id = ? limit ?',
    'select comments.*, (select row_to_json(users) from test.users where users.id = comments.user_id and users.id = 1 limit 1) as user from test.comments where comments.user_id = ? and comments.user_id = ? order by comments.id asc limit ?',
  ]);
  expect(queries.length).toBe(2);

  clearQueries();
  expect((await get('/test/users/me?include[]=comments')).data).toStrictEqual({
    data: {
      '@links': {},
      '@url': '/test/users/1',
      email: '1@abc.com',
      id: 1,
      comments: Array.from({ length: 10 }, (_, index) => ({
        '@links': {
          user: '/test/users/1',
        },
        '@url': `/test/comments/${index + 1}?userId=1`,
        id: index + 1,
        userId: 1,
        body: String(index),
      })),
    },
  });
  expect(queries.length).toBe(2);

  clearQueries();
  expect(
    (await get('/test/comments?mine&include[]=user&userId=1')).data
  ).toStrictEqual({
    meta: {
      page: 0,
      limit: 50,
      hasMore: false,
      '@url': '/test/comments?mine&include[]=user&userId=1',
      '@links': {
        count: '/test/comments/count?mine=&include[]=user&userId=1',
        ids: '/test/comments/ids?mine=&include[]=user&userId=1',
      },
    },
    data: Array.from({ length: 10 }, (_, index) => ({
      '@links': {},
      '@url': `/test/comments/${index + 1}?userId=1`,
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
  expect(queries.length).toBe(2);

  clearQueries();
  expect((await get('/test/comments/count?mine')).data).toStrictEqual({
    data: 10,
  });
  expect(queries.length).toBe(2);

  clearQueries();
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
      '@url': `/test/comments/${index + 1}?userId=1`,
      id: index + 1,
      userId: 1,
      body: String(index),
    })),
  });
  expect(queries.length).toBe(2);

  clearQueries();
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
  expect(queries.length).toBe(2);

  // create from has many
  clearQueries();
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
          '@url': '/test/comments/11?userId=11',
          body: 'hey',
          id: 11,
          userId: 11,
        },
        {
          '@links': {
            user: '/test/users/11',
          },
          '@url': '/test/comments/12?userId=11',
          body: '123',
          id: 12,
          userId: 11,
        },
      ],
      email: 'thing@email.com',
      id: 11,
    },
  });
  expect(queries.length).toBe(7);

  expect(events.length).toBe(3);
  expect(events[0].mode).toBe('insert');
  expect(events[1].mode).toBe('insert');
  expect(events[2].mode).toBe('insert');
  events = [];

  // create from has one
  clearQueries();
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
      '@url': '/test/comments/13?userId=12',
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
  expect(queries.length).toBe(5);

  expect(events.length).toBe(2);
  expect(events[0].mode).toBe('insert');
  expect(events[1].mode).toBe('insert');
  events = [];

  // create from has one but with a validation error
  clearQueries();
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
  expect(queries.length).toBe(1);
  expect(events.length).toBe(0);
  events = [];

  // create from has many with a validation error
  clearQueries();
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
  expect(queries.length).toBe(1);

  // cannot create outside this user's policy

  clearQueries();
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
  expect(queries.length).toBe(3);
  expect(events.length).toBe(0);
  events = [];

  const [newPost] = await knex('test.comments')
    .insert({
      userId: 2,
      body: 'thing',
    })
    .returning('*');
  clearQueries();
  expect(
    (
      await put(`/test/comments/${newPost.id}`, {
        body: 'hey',
        userId: 2,
      }).catch(e => {
        return e.response;
      })
    ).status
  ).toStrictEqual(401);
  expect(queries.length).toBe(2);
  expect(events.length).toBe(0);
  events = [];

  clearQueries();
  expect(
    (
      await put(`/test/comments/${newPost.id}`, {
        body: 'hey',
        userId: 1,
      }).catch(e => {
        return e.response;
      })
    ).status
  ).toStrictEqual(401);
  expect(queries.length).toBe(2);
  expect(events.length).toBe(0);
  events = [];

  const [newPost2] = await knex('test.comments')
    .insert({
      userId: 1,
      body: 'thing',
    })
    .returning('*');
  expect(
    (
      await get(`/test/comments/${newPost2.id}?userId=1`).catch(e => {
        return e.response;
      })
    ).status
  ).toStrictEqual(200);
  clearQueries();
  events = [];
  expect(
    (
      await put(`/test/comments/${newPost2.id}`, {
        body: 'hey',
        userId: 2,
      }).catch(e => {
        return e.response;
      })
    ).status
  ).toStrictEqual(401);
  expect(queries).toEqual([
    'select * from test.users where users.id = ? limit ?',
    'select comments.* from test.comments where comments.user_id = ? and comments.id = ? and comments.user_id = ? limit ?',
  ]);
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
  clearQueries();
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
  expect(queries.length).toBe(2);

  // cannot change an item to be outside this user's policy
  clearQueries();
  expect(
    (
      await put(`/test/comments/1`, {
        userId: 2,
      }).catch(e => {
        return e.response;
      })
    ).status
  ).toStrictEqual(401);
  expect(queries.length).toBe(2);

  // cannot edit outside this user's policy
  clearQueries();
  expect(
    (
      await del(`/test/comments/${newCommentId}?userId=2`).catch(e => {
        return e.response;
      })
    ).status
  ).toStrictEqual(401);
  expect(queries.length).toBe(2);
});

it('handles nullable relations', async () => {
  await knex.schema.withSchema('test').createTable('users', t => {
    t.bigIncrements('id').primary();
    t.string('email')
      .notNullable()
      .unique();
  });

  await knex.schema.withSchema('test').createTable('comments', t => {
    t.bigIncrements('id').primary();
    t.bigInteger('user_id').notNullable();
    t.bigInteger('reply_to_comment_id');
    t.string('body').notNullable();
    t.foreign('user_id')
      .references('id')
      .inTable('test.users');
  });

  await knex.schema.withSchema('test').alterTable('comments', t => {
    t.foreign('reply_to_comment_id')
      .references('id')
      .inTable('test.comments');
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

  await knex('test.comments')
    .where('id', 1)
    .update({
      replyToCommentId: 5,
    });

  const core = Core(knex, getContext);

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

  const { get } = await create(core, {
    headers: {
      impersonate: '1',
    },
  });

  clearQueries();
  expect((await get('/test/comments?userId=1&include[]=user')).data).toEqual({
    meta: {
      page: 0,
      limit: 50,
      hasMore: false,
      '@url': '/test/comments?userId=1&include[]=user',
      '@links': {
        count: '/test/comments/count?userId=1&include[]=user',
        ids: '/test/comments/ids?userId=1&include[]=user',
      },
    },
    data: Array.from({ length: 10 }, (_, index) => ({
      '@links':
        index + 1 === 1 ? { replyToComment: '/test/comments/5?userId=1' } : {},
      '@url': `/test/comments/${index + 1}?userId=1`,
      id: index + 1,
      replyToCommentId: index + 1 === 1 ? 5 : null,
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

  let { data } = await get('/test/comments?userId=1');

  expect(data).toEqual({
    data: [
      {
        '@links': {
          user: '/test/users/1',
        },
        '@url': '/test/comments/1?userId=1',
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
        '@url': '/test/comments/2?userId=1',
        body: '1',
        createdAt: '2020-05-01T06:00:00.000Z',
        id: 2,
        updatedAt: '2020-05-01T06:00:00.000Z',
        userId: 1,
      },
    ],
    meta: {
      '@links': {
        count: '/test/comments/count?userId=1',
        ids: '/test/comments/ids?userId=1',
      },
      '@url': '/test/comments?userId=1',
      hasMore: false,
      page: 0,
      limit: 50,
    },
  });

  // since works
  expect(
    (
      await get(
        `/test/comments?since=${encodeURIComponent('may 2, 2020')}&userId=1`
      )
    ).data
  ).toEqual({
    data: [],
    meta: {
      '@links': {
        count: '/test/comments/count?since=may%202%2C%202020&userId=1',
        ids: '/test/comments/ids?since=may%202%2C%202020&userId=1',
      },
      '@url': '/test/comments?since=may%202%2C%202020&userId=1',
      hasMore: false,
      page: 0,
      limit: 50,
    },
  });

  // passing an invalid since is ignored
  expect(
    (await get(`/test/comments?since=${encodeURIComponent('trash')}&userId=1`))
      .data
  ).toEqual({
    data: [
      {
        '@links': {
          user: '/test/users/1',
        },
        '@url': '/test/comments/1?userId=1',
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
        '@url': '/test/comments/2?userId=1',
        body: '1',
        createdAt: '2020-05-01T06:00:00.000Z',
        id: 2,
        updatedAt: '2020-05-01T06:00:00.000Z',
        userId: 1,
      },
    ],
    meta: {
      '@links': {
        count: '/test/comments/count?since=trash&userId=1',
        ids: '/test/comments/ids?since=trash&userId=1',
      },
      '@url': '/test/comments?since=trash&userId=1',
      hasMore: false,
      page: 0,
      limit: 50,
    },
  });

  // make sure updatedAt is updated
  const beforeUpdate = (await get('/test/comments/1?userId=1')).data.data;

  await put(`/test/comments/1`, {
    body: 'hey',
    userId: 1,
  });

  const afterUpdate = (await get('/test/comments/1?userId=1')).data.data;

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

  const { get, delete: del, post } = await create(core, {
    headers: {
      impersonate: '1',
    },
  });

  let { data } = await get('/test/comments?userId=1');

  expect(data).toEqual({
    data: [
      {
        '@links': {
          user: '/test/users/1',
        },
        '@url': '/test/comments/1?userId=1',
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
        '@url': '/test/comments/2?userId=1',
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
        count: '/test/comments/count?userId=1',
        ids: '/test/comments/ids?userId=1',
      },
      '@url': '/test/comments?userId=1',
      hasMore: false,
      page: 0,
      limit: 50,
    },
  });

  // make sure updatedAt is updated
  const beforeUpdate = (await get('/test/comments/1?userId=1')).data.data;

  await del(`/test/comments/1?userId=1`);

  const afterUpdate = (await get('/test/comments/1?userId=1')).data.data;

  expect(beforeUpdate.deletedAt).toEqual(null);
  expect(beforeUpdate.deletedAt).not.toEqual(afterUpdate.deletedAt);

  let { data: afterData } = await get('/test/comments?userId=1');
  expect(afterData).toEqual({
    data: [
      {
        '@links': {
          user: '/test/users/1',
        },
        '@url': '/test/comments/2?userId=1',
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
        count: '/test/comments/count?userId=1',
        ids: '/test/comments/ids?userId=1',
      },
      '@url': '/test/comments?userId=1',
      hasMore: false,
      page: 0,
      limit: 50,
    },
  });

  // make sure passing withDeleted gives the row
  let { data: afterDataWithDeleted } = await get(
    '/test/comments?withDeleted=true&userId=1'
  );
  expect(afterDataWithDeleted.data.length).toEqual(2);

  await del('/test/users/1?userId=1');

  const comments = await knex('test.comments');

  expect(comments.every(comment => comment.deletedAt !== null)).toBe(true);

  const {
    data: { data: created },
  } = await post('/test/comments', {
    body: 'thing',
    userId: 1,
  });

  expect(created).toEqual({
    '@links': {
      user: '/test/users/1',
    },
    '@url': '/test/comments/3?userId=1',
    body: 'thing',
    createdAt: created.createdAt,
    deletedAt: null,
    id: 3,
    updatedAt: created.updatedAt,
    userId: 1,
  });

  expect(created.createdAt).not.toBe(null);
  expect(created.updatedAt).not.toBe(null);
});

it('supports paranoid with tenant ids', async () => {
  await knex.schema.withSchema('test').createTable('orgs', t => {
    t.bigIncrements('id').primary();
  });

  await knex.schema.withSchema('test').createTable('users', t => {
    t.bigIncrements('id').primary();
    t.bigInteger('org_id')
      .references('id')
      .inTable('test.orgs');
    t.string('email')
      .notNullable()
      .unique();
    t.timestamps(true, true);
    t.timestamp('deleted_at', { useTz: true });
  });

  await knex.schema.withSchema('test').createTable('comments', t => {
    t.bigIncrements('id').primary();
    t.bigInteger('org_id')
      .references('id')
      .inTable('test.orgs');
    t.bigInteger('user_id').notNullable();
    t.string('body').notNullable();
    t.timestamps(true, true);
    t.timestamp('deleted_at', { useTz: true });
    t.foreign('user_id')
      .references('id')
      .inTable('test.users');
  });

  const [org] = await knex('test.orgs')
    .insert({})
    .returning('*');

  for (let i = 0; i < 2; i++) {
    await knex('test.users').insert({
      orgId: org.id,
      email: `${i + 1}@abc.com`,
    });

    const date = new Date('May 1, 2020');

    await knex('test.comments').insert({
      orgId: org.id,
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
    tenantIdColumnName: 'orgId',
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
      tenantIdColumnName: 'orgId',
      paranoid: true,
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

  const { get, delete: del, post } = await create(core, {
    headers: {
      impersonate: '1',
    },
  });

  let { data } = await get('/test/comments?orgId=1');

  expect(data).toEqual({
    data: [
      {
        '@links': {
          user: '/test/users/1?orgId=1',
        },
        '@url': '/test/comments/1?orgId=1',
        body: '0',
        createdAt: '2020-05-01T06:00:00.000Z',
        deletedAt: null,
        id: 1,
        updatedAt: '2020-05-01T06:00:00.000Z',
        userId: 1,
        orgId: 1,
      },
      {
        '@links': {
          user: '/test/users/1?orgId=1',
        },
        '@url': '/test/comments/2?orgId=1',
        body: '1',
        createdAt: '2020-05-01T06:00:00.000Z',
        deletedAt: null,
        id: 2,
        updatedAt: '2020-05-01T06:00:00.000Z',
        userId: 1,
        orgId: 1,
      },
    ],
    meta: {
      '@links': {
        count: '/test/comments/count?orgId=1',
        ids: '/test/comments/ids?orgId=1',
      },
      '@url': '/test/comments?orgId=1',
      hasMore: false,
      page: 0,
      limit: 50,
    },
  });

  // make sure updatedAt is updated
  const beforeUpdate = (await get('/test/comments/1?orgId=1')).data.data;

  await del(`/test/comments/1?orgId=1`);

  const afterUpdate = (await get('/test/comments/1?orgId=1')).data.data;

  expect(beforeUpdate.deletedAt).toEqual(null);
  expect(beforeUpdate.deletedAt).not.toEqual(afterUpdate.deletedAt);

  let { data: afterData } = await get('/test/comments?orgId=1');
  expect(afterData).toEqual({
    data: [
      {
        '@links': {
          user: '/test/users/1?orgId=1',
        },
        '@url': '/test/comments/2?orgId=1',
        body: '1',
        createdAt: '2020-05-01T06:00:00.000Z',
        deletedAt: null,
        id: 2,
        updatedAt: '2020-05-01T06:00:00.000Z',
        userId: 1,
        orgId: 1,
      },
    ],
    meta: {
      '@links': {
        count: '/test/comments/count?orgId=1',
        ids: '/test/comments/ids?orgId=1',
      },
      '@url': '/test/comments?orgId=1',
      hasMore: false,
      page: 0,
      limit: 50,
    },
  });

  // make sure passing withDeleted gives the row
  let { data: afterDataWithDeleted } = await get(
    '/test/comments?withDeleted=true&orgId=1'
  );
  expect(afterDataWithDeleted.data.length).toEqual(2);

  await del('/test/users/1?orgId=1');

  const comments = await knex('test.comments');

  expect(comments.every(comment => comment.deletedAt !== null)).toBe(true);

  const {
    data: { data: created },
  } = await post('/test/comments', {
    body: 'thing',
    userId: 1,
    orgId: 1,
  });

  expect(created).toEqual({
    '@links': {
      user: '/test/users/1?orgId=1',
    },
    '@url': '/test/comments/3?orgId=1',
    body: 'thing',
    createdAt: created.createdAt,
    deletedAt: null,
    id: 3,
    updatedAt: created.updatedAt,
    userId: 1,
    orgId: 1,
  });

  expect(created.createdAt).not.toBe(null);
  expect(created.updatedAt).not.toBe(null);
});

it('provides an eventsource endpoint', async () => {
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
  const core = Core(knex, getContext, { emitter });

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

  let sseVisibility: boolean[] = [];

  const { post, url } = await create(
    core,
    {
      headers: {
        impersonate: '1',
      },
    },
    app => {
      app.get(
        '/sse',
        core.sse(async isVisible => {
          const visible = await isVisible();
          sseVisibility.push(visible);
          return visible;
        })
      );
    }
  );

  const eventSource = new EventSource(`${url}/sse?impersonate=1`);

  let message: any = null;
  eventSource.addEventListener('update', (m: any) => {
    message = m;
  });

  await post('/test/comments', {
    body: '123',
    userId: 1,
  });

  await new Promise(r => {
    const int = setInterval(() => {
      if (message !== null) {
        expect(sseVisibility[0]).toBe(true);
        clearInterval(int);
        expect(message.data).toBe(
          '{"mode":"insert","tableName":"comments","schemaName":"test","row":{"id":11,"userId":1,"body":"123"}}'
        );
        message = null;
        r();
      }
    }, 100);
  });

  const [newRow] = await knex('test.comments')
    .insert({
      body: 'not visible',
      userId: '2',
    })
    .returning('*');

  emitter.emit('change', {
    mode: 'insert',
    tableName: 'comments',
    schemaName: 'test',
    row: newRow,
  });

  await new Promise(r => {
    const int = setInterval(() => {
      if (sseVisibility.length === 2) {
        clearInterval(int);
        expect(sseVisibility[1]).toBe(false);
        r();
      }
    }, 100);
  });

  eventSource.close();

  // this is to verify the 'end' callbacks are fired and noted in
  // coverage.
  await new Promise(r => {
    setTimeout(r, 1000);
  });
});

it('saves schema', async () => {
  await knex.schema.withSchema('test').createTable('users', t => {
    t.bigIncrements('id').primary();
    t.string('email')
      .notNullable()
      .unique();
    t.timestamps(true, true);
    t.timestamp('deleted_at', { useTz: true });
  });

  const core = Core(knex, getContext, {
    writeSchemaToFile: path.join(__dirname, './__test_schema.json'),
  });

  core.table({
    schemaName: 'test',
    tableName: 'users',
  });

  const { get } = await create(core, {
    headers: {
      impersonate: '1',
    },
  });

  await get('/test/users');

  queries = [];

  const core2 = Core(knex, getContext, {
    writeSchemaToFile: path.join(__dirname, './__test_schema.json'),
    loadSchemaFromFile: true,
  });

  core2.table({
    schemaName: 'test',
    tableName: 'users',
  });

  const { get: get2 } = await create(core2, {
    headers: {
      impersonate: '1',
    },
  });

  await get2('/test/users');
  expect(queries).toEqual([
    'select users.* from test.users order by users.id asc limit ?',
  ]);
});

it('saves typescript types', async () => {
  await knex.schema.withSchema('test').createTable('users', t => {
    t.bigIncrements('id').primary();
    t.string('email')
      .notNullable()
      .unique();
    t.timestamps(true, true);
    t.timestamp('deleted_at', { useTz: true });
    t.specificType('arr', 'text[]');
  });

  await knex.schema.withSchema('test').createTable('comments', t => {
    t.bigIncrements('id').primary();
    t.bigInteger('user_id').notNullable();
    t.string('body').notNullable();
    t.foreign('user_id')
      .references('id')
      .inTable('test.users');
  });

  const tsPath = path.join(__dirname, './__ts_out');

  const core = Core(knex, getContext, {
    writeTypesToFile: tsPath,
  });

  core.table({
    schemaName: 'test',
    tableName: 'users',
  });

  core.table({
    schemaName: 'test',
    tableName: 'comments',
  });

  const { get } = await create(core, {
    headers: {
      impersonate: '1',
    },
  });

  await get('/test/users');

  const out = await fs.readFile(tsPath, { encoding: 'utf-8' });

  expect(out.trim()).toMatchInlineSnapshot(`
    "export type Comment = {
      id: number;
      userId: number;
      body: string;
      '@url': string;
      '@links': {
        user: string;
      };
      user: User;
    };

    export type User = {
      id: number;
      email: string;
      createdAt: string;
      updatedAt: string;
      deletedAt: string | null;
      arr: string[] | null;
      '@url': string;
      '@links': {
        comments: string;
      };
      comments: Comment[];
    };"
  `);
});

it('saves typescript types without links', async () => {
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
    t.foreign('user_id')
      .references('id')
      .inTable('test.users');
  });

  const tsPath = path.join(__dirname, './__ts_out');

  const core = Core(knex, getContext, {
    writeTypesToFile: tsPath,
    includeLinksWithTypes: false,
  });

  core.table({
    schemaName: 'test',
    tableName: 'users',
  });

  core.table({
    schemaName: 'test',
    tableName: 'comments',
  });

  const { get } = await create(core, {
    headers: {
      impersonate: '1',
    },
  });

  await get('/test/users');

  const out = await fs.readFile(tsPath, { encoding: 'utf-8' });

  expect(out.trim()).toMatchInlineSnapshot(`
    "export type Comment = {
      id: number;
      userId: number;
      body: string;
      user: User;
    };

    export type User = {
      id: number;
      email: string;
      createdAt: string;
      updatedAt: string;
      deletedAt: string | null;
      comments: Comment[];
    };"
  `);
});

it('handles tables in the public schema', async () => {
  await knex.schema.createTable('test_table', t => {
    t.bigIncrements('id').primary();
    t.string('email')
      .notNullable()
      .unique();
    t.timestamps(true, true);
    t.timestamp('deleted_at', { useTz: true });
  });

  const core = Core(knex, getContext);

  core.table({
    tableName: 'testTable',
  });

  const { get } = await create(core, {
    headers: {
      impersonate: '1',
    },
  });

  const { data: out } = await get('/testTable');

  expect(out).toEqual({
    data: [],
    meta: {
      '@links': {
        count: '/testTable/count',
        ids: '/testTable/ids',
      },
      '@url': '/testTable',
      hasMore: false,
      limit: 50,
      page: 0,
    },
  });
});

it('handles getters', async () => {
  await knex.schema.withSchema('test').createTable('users', t => {
    t.bigIncrements('id').primary();
    t.string('email')
      .notNullable()
      .unique();
  });

  const core = Core(knex, getContext);

  core.table({
    schemaName: 'test',
    tableName: 'users',
    getters: {
      async avatar(row) {
        return row.email ? `http://avatar.io/${row.email}` : undefined;
      },
    },
  });

  const { get } = await create(core, {
    headers: {
      impersonate: '1',
    },
  });

  await knex('test.users').insert({
    email: 'thing@thang.com',
  });

  expect((await get('/test/users')).data).toEqual({
    data: [
      {
        '@links': {
          avatar: '/test/users/1/avatar',
        },
        '@url': '/test/users/1',
        email: 'thing@thang.com',
        id: 1,
      },
    ],
    meta: {
      '@links': {
        count: '/test/users/count',
        ids: '/test/users/ids',
      },
      '@url': '/test/users',
      hasMore: false,
      limit: 50,
      page: 0,
    },
  });

  expect((await get('/test/users?include=avatar')).data).toEqual({
    data: [
      {
        '@links': {},
        '@url': '/test/users/1?include[]=avatar',
        avatar: 'http://avatar.io/thing@thang.com',
        email: 'thing@thang.com',
        id: 1,
      },
    ],
    meta: {
      '@links': {
        count: '/test/users/count?include=avatar',
        ids: '/test/users/ids?include=avatar',
      },
      '@url': '/test/users?include=avatar',
      hasMore: false,
      limit: 50,
      page: 0,
    },
  });

  expect((await get('/test/users/1?include=avatar')).data).toEqual({
    data: {
      '@links': {},
      '@url': '/test/users/1?include[]=avatar',
      avatar: 'http://avatar.io/thing@thang.com',
      email: 'thing@thang.com',
      id: 1,
    },
  });

  expect((await get('/test/users/1/avatar')).data).toEqual({
    data: 'http://avatar.io/thing@thang.com',
  });
});

it('handles upserts', async () => {
  await knex.schema.withSchema('test').createTable('articles', t => {
    t.bigIncrements('id').primary();
  });
  await knex.schema.withSchema('test').createTable('article_types', t => {
    t.bigIncrements('id').primary();
    t.bigInteger('article_id')
      .references('id')
      .inTable('test.articles');
    t.text('type');
    t.text('initial');
    t.text('update');
    t.boolean('visible').defaultTo(true);
    t.unique(['article_id', 'type']);
  });

  const core = Core(knex, getContext);

  core.table({
    schemaName: 'test',
    tableName: 'articles',
  });
  core.table({
    schemaName: 'test',
    tableName: 'articleTypes',
    allowUpserts: true,
    async policy(stmt) {
      stmt.where('articleTypes.visible', true);
    },
  });

  const { get, put } = await create(core, {
    headers: {
      impersonate: '1',
    },
  });

  const [article] = await knex('test.articles')
    .insert({})
    .returning('*');

  await knex('test.article_types')
    .insert({
      articleId: article.id,
      type: 'type',
      initial: 'something',
      update: '1',
    })
    .returning('*');

  await knex('test.article_types')
    .insert({
      articleId: article.id,
      type: 'hidden',
      initial: 'something',
      update: '1',
      visible: false,
    })
    .returning('*');

  const { data: out } = await get('/test/articles?include[]=articleTypes');

  expect(out).toEqual({
    data: [
      {
        '@links': {},
        '@url': '/test/articles/1',
        articleTypes: [
          {
            '@links': {
              article: '/test/articles/1',
            },
            '@url': '/test/articleTypes/1',
            articleId: 1,
            id: 1,
            type: 'type',
            initial: 'something',
            update: '1',
            visible: true,
          },
        ],
        id: 1,
      },
    ],
    meta: {
      '@links': {
        count: '/test/articles/count?include[]=articleTypes',
        ids: '/test/articles/ids?include[]=articleTypes',
      },
      '@url': '/test/articles?include[]=articleTypes',
      hasMore: false,
      limit: 50,
      page: 0,
    },
  });

  const {
    data: { data },
  } = await put('/test/articles/1', {
    articleTypes: [{ type: 'type', update: '2' }],
  });

  expect(data).toEqual({
    '@links': {
      articleTypes: '/test/articleTypes?articleId=1',
    },
    '@url': '/test/articles/1',
    articleTypes: [
      {
        '@links': {
          article: '/test/articles/1',
        },
        '@url': '/test/articleTypes/1',
        articleId: 1,
        id: 1,
        initial: 'something',
        update: '2',
        type: 'type',
        visible: true,
      },
    ],
    id: 1,
  });

  // this should fail because it's updating a unique item that is already in use
  const { status, data: data2 } = await put('/test/articles/1', {
    articleTypes: [{ type: 'hidden', update: '2' }],
  }).catch(e => e.response);

  expect(status).toEqual(400);
  expect(data2).toEqual({
    errors: {
      articleTypes: [
        {
          articleId: 'is already in use',
          type: 'is already in use',
        },
      ],
    },
  });
});

it('uses tenant ids for including related queries', async () => {
  await knex.schema.withSchema('test').createTable('orgs', t => {
    t.bigIncrements('id').primary();
  });

  await knex.schema.withSchema('test').createTable('parents', t => {
    t.bigIncrements('id').primary();
    t.bigInteger('org_id')
      .references('id')
      .inTable('test.orgs')
      .notNullable();
  });

  await knex.schema.withSchema('test').createTable('children', t => {
    t.bigIncrements('id').primary();
    t.bigInteger('org_id')
      .references('id')
      .inTable('test.orgs')
      .notNullable();
    t.bigInteger('parent_id')
      .references('id')
      .inTable('test.parents');
    t.string('uid')
      .unique()
      .notNullable();
  });

  const core = Core(knex, getContext);

  core.table({
    schemaName: 'test',
    tableName: 'orgs',
  });
  core.table({
    schemaName: 'test',
    tableName: 'parents',
    tenantIdColumnName: 'orgId',
  });
  core.table({
    schemaName: 'test',
    tableName: 'children',
    tenantIdColumnName: 'orgId',
  });

  const { get, post, put, delete: del } = await create(core, {
    headers: {
      impersonate: '1',
    },
  });

  const [org] = await knex('test.orgs')
    .insert({})
    .returning('*');

  const [parent] = await knex('test.parents')
    .insert({ orgId: org.id })
    .returning('*');

  for (let i = 0; i < 2; i++) {
    await knex('test.children').insert({
      orgId: org.id,
      parentId: parent.id,
      uid: i,
    });
  }

  await get('/test/orgs');

  queries = [];
  const { data: out } = await get('/test/parents?include[]=children&orgId=1');

  expect(out).toEqual({
    data: [
      {
        '@links': {
          org: '/test/orgs/1',
        },
        '@url': '/test/parents/1?orgId=1',
        children: [
          {
            '@links': {
              org: '/test/orgs/1',
              parent: '/test/parents/1?orgId=1',
            },
            '@url': '/test/children/1?orgId=1',
            id: 1,
            orgId: 1,
            parentId: 1,
            uid: '0',
          },
          {
            '@links': {
              org: '/test/orgs/1',
              parent: '/test/parents/1?orgId=1',
            },
            '@url': '/test/children/2?orgId=1',
            id: 2,
            orgId: 1,
            parentId: 1,
            uid: '1',
          },
        ],
        id: 1,
        orgId: 1,
      },
    ],
    meta: {
      '@links': {
        count: '/test/parents/count?include[]=children&orgId=1',
        ids: '/test/parents/ids?include[]=children&orgId=1',
      },
      '@url': '/test/parents?include[]=children&orgId=1',
      hasMore: false,
      limit: 50,
      page: 0,
    },
  });

  expect(queries).toEqual([
    'select parents.*, array(select row_to_json(children) from test.children where children.org_id = parents.org_id and children.parent_id = parents.id limit 10) as children from test.parents where parents.org_id = ? order by parents.id asc limit ?',
  ]);

  expect(
    (
      await post('/test/parents', {
        orgId: 1,
        children: [{ orgId: 1, uid: 'post' }],
      })
    ).data
  ).toEqual({
    data: {
      '@links': {
        children: '/test/children?parentId=2&orgId=1',
        org: '/test/orgs/1',
      },
      '@url': '/test/parents/2?orgId=1',
      children: [
        {
          '@links': {
            org: '/test/orgs/1',
            parent: '/test/parents/2?orgId=1',
          },
          '@url': '/test/children/3?orgId=1',
          id: 3,
          orgId: 1,
          parentId: 2,
          uid: 'post',
        },
      ],
      id: 2,
      orgId: 1,
    },
  });

  expect((await post('/test/parents', {}).catch(r => r.response)).data).toEqual(
    {
      errors: {
        orgId: 'is required',
      },
    }
  );

  expect(
    (await put('/test/parents/2', {}).catch(r => r.response)).data
  ).toEqual({
    errors: {
      orgId: 'is required',
    },
  });

  expect(
    (await del('/test/parents/2', {}).catch(r => r.response)).data
  ).toEqual({
    errors: {
      orgId: 'is required',
    },
  });

  expect(
    (await post('/test/children', { uid: 'post' }).catch(r => r.response)).data
  ).toEqual({
    errors: {
      orgId: 'is required',
      uid: 'is already in use',
    },
  });

  expect(
    (
      await post('/test/children', { uid: 'post', orgId: 1 }).catch(
        r => r.response
      )
    ).data
  ).toEqual({
    errors: {
      uid: 'is already in use',
    },
  });

  expect(
    (await post('/test/children', { uid: 'post', orgId: 1, id: 3 })).data
  ).toEqual({
    data: {
      '@links': {
        org: '/test/orgs/1',
        parent: '/test/parents/2?orgId=1',
      },
      '@url': '/test/children/3?orgId=1',
      id: 3,
      orgId: 1,
      parentId: 2,
      uid: 'post',
    },
  });
});

it('handles querystring changes like null, date, number', async () => {
  await knex.schema.withSchema('test').createTable('resource', t => {
    t.bigIncrements('id').primary();
    t.boolean('nullable');
    t.boolean('bool');
    t.timestamp('date', { useTz: true });
    t.integer('number');
  });

  const core = Core(knex, getContext);

  core.table({
    schemaName: 'test',
    tableName: 'resource',
  });

  const { get, post } = await create(core, {
    headers: {
      impersonate: '1',
    },
  });

  const date = new Date();

  const [row] = await knex('test.resource')
    .insert({
      bool: false,
      date: date,
      number: 1,
    })
    .returning('*');

  await knex('test.resource')
    .insert({
      nullable: false,
      bool: true,
      date: date,
      number: 1,
    })
    .returning('*');

  await get('/test/resource');

  expect((await get('/test/resource?nullable=')).data).toEqual({
    data: [
      {
        '@links': {},
        '@url': '/test/resource/1',
        bool: false,
        date: row.date.toISOString(),
        id: 1,
        nullable: null,
        number: 1,
      },
    ],
    meta: {
      '@links': {
        count: '/test/resource/count?nullable=',
        ids: '/test/resource/ids?nullable=',
      },
      '@url': '/test/resource?nullable=',
      hasMore: false,
      limit: 50,
      page: 0,
    },
  });

  expect((await get('/test/resource?bool=false')).data).toEqual({
    data: [
      {
        '@links': {},
        '@url': '/test/resource/1',
        bool: false,
        date: row.date.toISOString(),
        id: 1,
        nullable: null,
        number: 1,
      },
    ],
    meta: {
      '@links': {
        count: '/test/resource/count?bool=false',
        ids: '/test/resource/ids?bool=false',
      },
      '@url': '/test/resource?bool=false',
      hasMore: false,
      limit: 50,
      page: 0,
    },
  });

  expect((await get('/test/resource?bool=true')).data).toEqual({
    data: [
      {
        '@links': {},
        '@url': '/test/resource/2',
        bool: true,
        date: row.date.toISOString(),
        id: 2,
        nullable: false,
        number: 1,
      },
    ],
    meta: {
      '@links': {
        count: '/test/resource/count?bool=true',
        ids: '/test/resource/ids?bool=true',
      },
      '@url': '/test/resource?bool=true',
      hasMore: false,
      limit: 50,
      page: 0,
    },
  });

  expect((await get('/test/resource?number=1')).data).toEqual({
    data: [
      {
        '@links': {},
        '@url': '/test/resource/1',
        bool: false,
        date: row.date.toISOString(),
        id: 1,
        nullable: null,
        number: 1,
      },
      {
        '@links': {},
        '@url': '/test/resource/2',
        bool: true,
        date: row.date.toISOString(),
        id: 2,
        nullable: false,
        number: 1,
      },
    ],
    meta: {
      '@links': {
        count: '/test/resource/count?number=1',
        ids: '/test/resource/ids?number=1',
      },
      '@url': '/test/resource?number=1',
      hasMore: false,
      limit: 50,
      page: 0,
    },
  });

  expect(
    (
      await post('/test/resource', {
        date: date.toISOString(),
        bool: 'false',
        number: '1',
      })
    ).data
  ).toEqual({
    data: {
      '@links': {},
      '@url': '/test/resource/3',
      bool: false,
      date: date.toISOString(),
      id: 3,
      nullable: null,
      number: 1,
    },
  });
});

it('allows specifying an origin', async () => {
  await knex.schema.withSchema('test').createTable('resource', t => {
    t.bigIncrements('id').primary();
  });
  await knex.schema.withSchema('test').createTable('children', t => {
    t.bigIncrements('id').primary();
    t.bigInteger('resource_id')
      .references('id')
      .inTable('test.resource');
  });

  const [resource] = await knex('test.resource')
    .insert({})
    .returning('*');
  await knex('test.children').insert({
    resourceId: resource.id,
  });

  const core = Core(knex, getContext, { origin: 'http://localhost:3000' });

  core.table({
    schemaName: 'test',
    tableName: 'resource',
  });
  core.table({
    schemaName: 'test',
    tableName: 'children',
  });

  const { get } = await create(core, {
    headers: {
      impersonate: '1',
    },
  });

  expect((await get('/test/resource')).data).toEqual({
    data: [
      {
        '@links': {
          children: 'http://localhost:3000/test/children?resourceId=1',
        },
        '@url': 'http://localhost:3000/test/resource/1',
        id: 1,
      },
    ],
    meta: {
      '@links': {
        count: 'http://localhost:3000/test/resource/count',
        ids: 'http://localhost:3000/test/resource/ids',
      },
      '@url': 'http://localhost:3000/test/resource',
      hasMore: false,
      limit: 50,
      page: 0,
    },
  });
});

it('disallows edits that make a row uneditable', async () => {
  await knex.schema.withSchema('test').createTable('users', t => {
    t.bigIncrements('id').primary();
  });
  await knex.schema.withSchema('test').createTable('resource', t => {
    t.bigIncrements('id').primary();
    t.bigInteger('user_id')
      .references('id')
      .inTable('test.users');
  });

  await knex('test.users').insert({});
  await knex('test.users').insert({});

  await knex('test.resource')
    .insert({
      userId: 1,
    })
    .returning('*');

  const core = Core(knex, getContext, { origin: 'http://localhost:3000' });

  core.table({
    schemaName: 'test',
    tableName: 'resource',
    async policy(query: QueryBuilder, { getUser }) {
      const user = await getUser();
      if (!user) return;
      query.where('resource.userId', user.id);
    },
  });

  const { get, put } = await create(core, {
    headers: {
      impersonate: '1',
    },
  });

  expect((await get('/test/resource/1')).data).toEqual({
    data: {
      '@links': {},
      '@url': 'http://localhost:3000/test/resource/1',
      id: 1,
      userId: 1,
    },
  });

  queries = [];
  expect(
    (
      await put('/test/resource/1', {
        userId: 2,
      }).catch(e => e.response)
    ).status
  ).toEqual(401);
  expect(queries).toEqual([
    // get user
    'select * from test.users where users.id = ? limit ?',
    // get row for validations
    'select resource.* from test.resource where resource.user_id = ? and resource.id = ? limit ?',
    // get row for updating (in transaction)
    'select resource.* from test.resource where resource.user_id = ? and resource.id = ? limit ?',
    // update row
    'update test.resource set user_id = ? where resource.user_id = ? and resource.id = ?',
    // is row still visible?
    'select resource.* from test.resource where resource.user_id = ? and resource.id = ? limit ?',
  ]);
});

it('allows setters', async () => {
  await knex.schema.withSchema('test').createTable('resource', t => {
    t.bigIncrements('id').primary();
  });

  const core = Core(knex, getContext);

  let value = null;
  let row = null;
  core.table({
    schemaName: 'test',
    tableName: 'resource',
    setters: {
      async val(trx, v, r) {
        // make sure this doesn't throw
        await trx('test.resource');

        value = v;
        row = r;
      },
    },
  });

  const { post, put } = await create(core, {
    headers: {
      impersonate: '1',
    },
  });

  expect((await post('/test/resource', { val: 1 })).data).toEqual({
    data: {
      '@links': {},
      '@url': '/test/resource/1',
      id: 1,
    },
  });
  expect(value).toBe(1);
  expect(row).toEqual({ id: 1 });

  value = null;
  row = null;

  expect((await put('/test/resource/1', { val: 2 })).data).toEqual({
    data: {
      '@links': {},
      '@url': '/test/resource/1',
      id: 1,
    },
  });
  expect(value).toBe(2);
  expect(row).toEqual({ id: 1 });
});

it('allows methods', async () => {
  await knex.schema.withSchema('test').createTable('users', t => {
    t.bigIncrements('id').primary();
  });
  await knex.schema.withSchema('test').createTable('jobs', t => {
    t.bigIncrements('id').primary();
    t.boolean('active').defaultTo(true);
    t.integer('user_id');
  });

  await knex('test.users').insert({});
  await knex('test.jobs')
    .insert({ userId: 1 })
    .returning('*');

  const core = Core(knex, getContext);

  let receivedBody = null;
  core.table({
    schemaName: 'test',
    tableName: 'jobs',
    async policy(query, { getUser }) {
      query.where('jobs.userId', (await getUser()).id);
    },
    methods: {
      async deactivate(row, _context, body) {
        receivedBody = body;
        await knex('test.jobs')
          .update({ active: false })
          .where('id', row.id);

        return { ok: true };
      },
    },
  });

  const { post } = await create(core, {
    headers: {
      impersonate: '1',
    },
  });

  expect(
    (await post('/test/jobs/1/deactivate', { val: 1 })).data
  ).toStrictEqual({
    ok: true,
  });
  expect(receivedBody).toStrictEqual({ val: 1 });
  expect(
    (await post('/test/jobs/2/deactivate', { val: 1 }).catch(e => e.response))
      .status
  ).toBe(404);
});

it('allows methods (with tenant)', async () => {
  await knex.schema.withSchema('test').createTable('users', t => {
    t.bigIncrements('id').primary();
  });
  await knex.schema.withSchema('test').createTable('jobs', t => {
    t.bigIncrements('id').primary();
    t.boolean('active').defaultTo(true);
    t.integer('user_id');
  });

  await knex('test.users').insert({});
  await knex('test.jobs')
    .insert({ userId: 1 })
    .returning('*');

  const core = Core(knex, getContext);

  let receivedBody = null;
  core.table({
    schemaName: 'test',
    tableName: 'jobs',
    tenantIdColumnName: 'userId',
    async policy(query, { getUser }) {
      query.where(`${this.alias}.userId`, (await getUser()).id);
    },
    methods: {
      async deactivate(row, _context, body) {
        receivedBody = body;
        await knex('test.jobs')
          .update({ active: false })
          .where('id', row.id)
          .where('userId', row.userId);

        return { ok: true };
      },
    },
  });

  const { post } = await create(core, {
    headers: {
      impersonate: '1',
    },
  });

  expect(
    (await post('/test/jobs/1/deactivate?userId=1', { val: 1 })).data
  ).toStrictEqual({
    ok: true,
  });
  expect(receivedBody).toStrictEqual({ val: 1 });
  expect(
    (
      await post('/test/jobs/2/deactivate?userId=1', { val: 1 }).catch(
        e => e.response
      )
    ).status
  ).toBe(404);
  expect(
    (await post('/test/jobs/2/deactivate', { val: 1 }).catch(e => e.response))
      .status
  ).toBe(400);

  expect(await knex('test.jobs').first()).toStrictEqual({
    id: 1,
    userId: 1,
    active: false,
  });
});

it('allows arrays', async () => {
  await knex.schema.withSchema('test').createTable('resource', t => {
    t.bigIncrements('id').primary();
    t.specificType('arr', 'text[]').notNullable();
  });

  const core = Core(knex, getContext);

  core.table({
    schemaName: 'test',
    tableName: 'resource',
  });

  const { get, post, put } = await create(core, {
    headers: {
      impersonate: '1',
    },
  });

  expect(
    (await post('/test/resource', { arr: [1, 2, 3] }).catch(e => e.response))
      .data
  ).toMatchInlineSnapshot(`
    Object {
      "errors": Object {
        "arr": Object {
          "0": "must be a \`string\` type, but the final value was: \`1\`.",
          "1": "must be a \`string\` type, but the final value was: \`2\`.",
          "2": "must be a \`string\` type, but the final value was: \`3\`.",
        },
      },
    }
  `);

  expect((await post('/test/resource', { arr: ['a', 'b', 'c'] })).data)
    .toMatchInlineSnapshot(`
    Object {
      "data": Object {
        "@links": Object {},
        "@url": "/test/resource/1",
        "arr": Array [
          "a",
          "b",
          "c",
        ],
        "id": 1,
      },
    }
  `);

  expect((await get('/test/resource/1')).data).toMatchInlineSnapshot(`
    Object {
      "data": Object {
        "@links": Object {},
        "@url": "/test/resource/1",
        "arr": Array [
          "a",
          "b",
          "c",
        ],
        "id": 1,
      },
    }
  `);

  expect((await put('/test/resource/1', { arr: ['a', 'b', 'c', 'd'] })).data)
    .toMatchInlineSnapshot(`
    Object {
      "data": Object {
        "@links": Object {},
        "@url": "/test/resource/1",
        "arr": Array [
          "a",
          "b",
          "c",
          "d",
        ],
        "id": 1,
      },
    }
  `);
});

it('forwards params', async () => {
  await knex.schema.withSchema('test').createTable('users', t => {
    t.bigIncrements('id').primary();
  });
  await knex.schema.withSchema('test').createTable('jobs', t => {
    t.bigIncrements('id').primary();
    t.boolean('active').defaultTo(true);
    t.integer('user_id')
      .references('id')
      .inTable('test.users');
  });

  await knex('test.users').insert({});
  await knex('test.jobs')
    .insert({ userId: 1 })
    .returning('*');

  const core = Core(knex, getContext, { forwardQueryParams: ['__token__'] });

  core.table({
    schemaName: 'test',
    tableName: 'users',
    async policy(query, { getUser }) {
      query.where('users.id', (await getUser()).id);
    },
  });

  core.table({
    schemaName: 'test',
    tableName: 'jobs',
    async policy(query, { getUser }) {
      query.where('jobs.userId', (await getUser()).id);
    },
  });

  const { get } = await create(core, {
    headers: {
      impersonate: '1',
    },
  });

  expect((await get('/test/users/1?__token__=abc123')).data)
    .toMatchInlineSnapshot(`
    Object {
      "data": Object {
        "@links": Object {
          "jobs": "/test/jobs?__token__=abc123&userId=1",
        },
        "@url": "/test/users/1?__token__=abc123",
        "id": 1,
      },
    }
  `);
});
