const Path = require("path");
const { knexHelpers, Core } = require("@synvox/core");
const express = require("express");
const Knex = require("knex").default;

const knex = Knex({
  client: "pg",
  connection: {
    database: process.env.USER,
  },
  ...knexHelpers,
});

const core = new Core(knex, () => ({}));

core.table({
  schemaName: "coreExample",
  tableName: "tasks",
});

const app = express();
app.use(require("cors")());
app.use(core.router);
app.use("/sse", core.sse());
app.listen(2021);

async function init() {
  await knex.schema.createSchemaIfNotExists("coreExample");

  const exists = await knex.schema.withSchema("core_example").hasTable("tasks");
  if (!exists)
    await knex.schema.withSchema("coreExample").createTable("tasks", (t) => {
      t.bigIncrements("id");
      t.boolean("isDone");
      t.text("body");
    });

  await core.init();
  await core.saveTsTypes(Path.resolve(__dirname, "../types.ts"));
}

init();
