const express = require('express');
const Knex = require('knex');
const { core: Core, knexHelpers } = require('./dist');

const auth = (req, knex) => {
  return {
    async getUser() {
      const { impersonate = undefined } = { ...req.headers, ...req.query };

      if (impersonate) {
        return await knex('test.users')
          .where('id', impersonate)
          .first();
      } else return null;
    },
    async getTenantIds() {
      const user = await this.getUser();
      if (!user) return [];

      return [user.id];
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

const core = Core(knex, auth);

core.register({
  schemaName: 'test',
  tableName: 'users',
});

const app = express();
app.use(express.json());
app.use(core.router);

async function main() {
  // await knex.raw(`
  //   drop schema if exists test cascade;
  //   create schema test;
  // `);

  // await knex.schema.withSchema('test').createTable('users', t => {
  //   t.bigIncrements('id').primary();
  //   t.string('email').unique();
  // });

  // for (let i = 0; i < 1000; i++) {
  //   await knex('test.users').insert({
  //     email: `${i + 1}@abc.com`,
  //   });
  // }

  app.listen(5030);

  console.log('listening on 5030');
}

main();
