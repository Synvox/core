# `@synvox/core`

Core is a middleware for `express` that creates restful endpoints automatically. In development, Core will read your database schema and store its structure in a JSON file. It uses this information to create endpoints to read and write to these tables.

## Authentication

```js
const core = new Core((req, res) => {
  return {
    async getUser() {
      return await findUser(req.headers.authorization);
    },
  };
});

app.use("/api", core.router());
```

Core will create a `context` for each request. This `context` is created from the `req` and `res` objects and should provide enough information about the client sending the request, including information about the entity they are authenticating as.

You can use any type of authentication library here to populate the `context` object.

## Authorization

```js
const core = new Core((req, res) => {
  return {
    async getUser() {
      return await findUser(req.headers.authorization);
    },
  };
});

core.table({
  tableName: "users",
  async policy(stmt, context, mode) {
    const user = await context.getUser();
    stmt.where(`users.id`, user.id);
  },
});

app.use("/api", core.router());

// GET /api/users -> 200
```

Core tables have a policy method, where you can modify the query with the context defined earlier. In this case every query to `users` will now have `where users.id = ?` appended with `user.id` added as a binding.

A request's `mode` is also given which is `"insert" | "read" | "update" | "delete"`. You can use this to create common authorization schemes like a twitter clone:

```js
const core = new Core((req, res) => {
  return {
    async getUser() {
      return await findUser(req.headers.authorization);
    },
  };
});

core.table({
  tableName: "tweets",
  async policy(stmt, context, mode) {
    if (mode === "update") throw new NotAuthorizedError();

    if (mode !== "read") {
      const user = await context.getUser();
      stmt.where(`users.id`, user.id);
    }
  },
  async defaultParams(context, mode) {
    const user = await context.getUser();
    switch(mode){
      case: 'insert':
        return {
          userId: user.id
        }
      default:
        return {}
    }
  },
});

app.use("/api", core.router());

// POST /api/tweets { body: 'Hello World' } -> 200
// PUT /api/tweets/:id { body: 'Update' } -> 401
// GET /api/tweets/:id -> 200
```

## Querying

```js
const core = new Core((req, res) => {
  return {
    async getUser() {
      return await findUser(req.headers.authorization);
    },
  };
});

core.table({
  tableName: "people",
});

app.use("/api", core.router());
```

If a client requests

```
GET /api/products?name=Paper
```

Core will build a query like:

```sql
select
  products.name,
  products.price
from products
where products.name = ?
order by products.id
limit ?
```

Filters for each column on `persons` are avalible as a query param. Additionally, if you need to query given multiple values, use bracket notation: `?id[]=1&id[]=2`.
