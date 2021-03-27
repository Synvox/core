# `@synvox/core`

Core is a middleware for `express` that creates restful endpoints automatically. It uses `knex` to connect to `postgres` and `yup` for validations.

In development, Core will read your database schema and store its structure in a JSON file. It uses this information to create endpoints to read and write to these tables.

It has many comfort features along the way:

- Policy restrictions for create, read, update, and delete
  `GET /answers?userId=2 -> 401`
- Selective eager loading avoiding N+1 queries
  `GET /posts?include[]=author`
- HATEOAS links for traversing the graph and discovery
  `GET /users/1 -> { data: { id: 1, _links: { posts: '/links?userId=1' } } }`
- Validations and conflict detection
  `POST /users {username: 'user'} -> { errors: { username: 'is already in use' } }`
- Customizable yup schema per table
  `schema: { email: yup().required().string().email() }`
- Graph updates, inserts, and upserts
  `POST /questions {answers: [{ label:'A', isCorrect: true }]}`
- Tenant id enforcement
  `GET /:tenantId/users -> 400 { errors: { tenantId: 'is required' } }`
- Cursor and offset based pagination
  `GET /users -> { meta: {nextPage: '/users?cursor=base64cursor' }, data: [...] }`
- ID modifiers
  `GET /users/self` vs `GET /users/1`
- Query string modifiers
  `GET /deals?userId=1 -> select * from deals where id in (select id from user_deals where id = ?)`
- Derive default parameters for a table
  `POST /posts { body: 'Yo' } -> 200 { data: { id: 1, body: 'Yo', userId: 1} }`
- Before update and after transaction commit hooks
- Created at and Updated at timestamps
- Soft deletes with cascading (i.e set `deleted_at` of dependents on soft delete)
- Selects known columns for a table instead of `select * from table`
- Support for hidden columns and readOnly columns
- Exposes a Server Sent Event endpoint to listen to changes visible given the user's policy
- Unopinionated Authentication
- Support for read/write replicas
- Exposes apis in `camelCase` while communicating with the database using `snake_case`
- uuid support
- Multiple schema support
- Add an `EventEmitter` of your choosing to listen to events

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

Core will create a `context` for each request. This `context` is created from the `req` and `res` objects and should provide enough information about the client sending the request, including information about the entity to which they are authenticating.

You can use any type of authentication library here to populate the `context` object, read from `req.session`, or similar.

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

### Role Based Authorization

```js
const core = new Core((req, res) => {
  return {
    async getUser() {
      return await findUser(req.headers.authorization);
    },
  };
});

core.table({
  tableName: "adminReports",
  async policy(stmt, context, mode) {
    const user = await context.getUser();
    stmt.whereIn(
      `adminReports.orgId`,
      knex("userRoles")
        .select("orgId")
        .where("roleId", "admin")
        .where("userId", user.id)
    );
  },
});

app.use("/api", core.router());
```

Each query to a table can be modified, so you can filter by a role existing in another table for the current user.

## Querying

Lets say you have an application that has a `products` table like this:

```js
const core = new Core((req, res) => {
  return {
    async getUser() {
      return await findUser(req.headers.authorization);
    },
  };
});

core.table({
  tableName: "products",
});

app.use("/api", core.router());
```

This will build endpoints for `/api/products`. If a client requests:

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

Filters for each column on `persons` are available as a query param. Additionally, if you need to query given multiple values, use bracket notation: `?id[]=1&id[]=2`. Bracket notation will add a `where in (?)` clause to the query.

If you need more control over your query, there are a number of operators available:

- `/table?column.eq=1` which adds "column = 1"
- `/table?column.neq=1` which adds "column <> 1"
- `/table?column.lt=1` which adds "column < 1"
- `/table?column.lte=1` which adds "column <= 1"
- `/table?column.gt=1` which adds "column > 1"
- `/table?column.gte=1` which adds "column >= 1"
- `/table?column.like=search` which adds "column like 'search'"
- `/table?column.ilike=SeArCh` which adds "column ilike SeArCh"

If you want to query for rows `not` `eq` to a value, add `.not` after the column name:

- `/table?column.not.eq=1` which adds "not column = 1"

If you need to build a more complex query with ANDs and ORs, use bracket notation:

- `/users?isPaid=true&and[isAdmin]=false` which adds "where is_paid = true and is_admin = false"
- `/deals?isWon=true&or[isLost]=true` which adds "where is_won = true or is_lost = true",

### More query options

The predefined query filters are not always enough. For other special cases you can define a `queryModifier`:

```js
const core = new Core((req, res) => {
  return {
    async getUser() {
      return await findUser(req.headers.authorization);
    },
  };
});

core.table({
  tableName: "contacts",
  queryModifiers: {
    async fullName(value, stmt) {
      stmt.whereRaw("contacts.first_name || contacts.last_name ilike ?", [
        value,
      ]);
    },
  },
});

app.use("/api", core.router());
```

This way you can call `/contacts?fullName=Billy%20Bob`

### Defining a special ID param

Calling `/users/whoami` or `/users/me` or `/users/self` is pretty common in most apps. With Core, you can define a special `id` value

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
  idModifiers: {
    async me(stmt, context) {
      const user = await context.getUser();
      stmt.where("users.id", user.id);
    },
  },
});

app.use("/api", core.router());
```

## Eager Loading

Eager loading is done through a reserved `include` query param.

If you have an application like this:

```js
core.table({ tableName: "posts" });
core.table({ tableName: "comments" });
core.table({ tableName: "users" });

app.use("/api", core.router());
```

And a client calls `/api/users?include[]=posts&include[]=comments`, then the response will include the posts and comments for users.

The same works for requests like `/api/comments?include[]=user&include[]=posts`. The response will include the user and post for each comment.

When an `include` is selecting a collection without bounds, i.e. one-to-many relations, the sub query will be limited to 10 results. This is to limit eager queries that over fetch without pagination. To get around this, make a separate, paginated request to the collection.

### Eager loading queries

Sometimes the data you intend to load is not in a related table, but is in the database. For these scenarios you can use `eagerGetters`.

```js
core.table({
  tableName: "users",
  eagerGetters: {
    async assignedTicketStats(stmt, context) {
      const user = await context.getUser();
      stmt
        .from("tickets")
        .whereRaw("tickets.user_id = ?", [user.id])
        .where("isOpen", true)
        .countDistinct("tickets.id as openTickets");
    },
  },
});

app.use("/api", core.router());
```

These are called with the `include` param as well. e.g. `/users?include[]=assignedTicketStats`

### Other Eager loading

For other times there is no way around a N+1 query. Sometimes this is simple like concatenating a first and last name and sometimes it is making an api call to a billing software to fetch customer information.

```js
core.table({
  tableName: "users",
  getters: {
    async fullName(row) {
      return [row.firstName, row.lastName].filter(Boolean).join(" ");
    },
    async paymentStatus(row) {
      const status = await getStatusFromBilling(row);
      return status;
    },
  },
});

app.use("/api", core.router());
```

These are called with the `include` param as well. e.g. `/users?include[]=fullName&include[]=paymentStatus`

## HATEOAS links

To provide hints to clients about the relations between apis, Core will add three properties to each row table:

```json
{
  "_url": "/tasks/1", // url to this row
  "_type": "tasks", // pathname to this resource
  "_links": {
    "epic": "/epic/2",
    "user": "/users/3",
    "comments": "/comments?taskId=1"
  },

  // assuming these properties are on the row:
  "id": 1,
  "epicId": 2,
  "userId": 3
}
```

Each key of `_links` can be included in the `include[]` query parameter.

## Validations

Core uses `yup` to build a `yup` `schema` for validation. After reading the column information for a table, Core will build a basic schema to ensure properties are compatible with the table schema before any transaction is opened.

For example, if you have this table:

```sql
create table users (
  id serial primary key,
  email text not null unique
);
```

Core will build a schema similar to:

```js
object({
  id: number(), // not required because a serial column has a default value
  email: string().required(),
});
```

This is fine, until you realize email needs to be a `yup` `string().email()`. You can define this change as you describe the table to Core:

```js
core.table({
  tableName: "users",
  schema: {
    email: string().email(),
  },
});
```

Core will `concat()` your defined schema to its internal schema.

### Unique columns

Core adds a yup test when a column is part of a unique constraint. For example, if you `POST /users { email: 'existing@domain.com' }` and that email is already in use, the client will be sent a `400` status code with this body:

```json
{
  "errors": {
    "email": "is already in use"
  }
}
```

This works with unique constraints on multiple columns as well. If you have this table:

```sql
create table users (
  id serial primary key,
  team_id int not null references team(id),
  email text not null,
  unique(team_id, email)
);
```

Then `POST /users { teamId: 1, email: 'existing@domain.com' }` and both `team_id` and `email` already exist as a pair in `users`, the client will be sent:

```json
{
  "errors": {
    "teamId": "is already in use",
    "email": "is already in use"
  }
}
```

### Validate without write

If you need to validate an update without writing it, append `/validate` to the url. For example, if you wanted to validate that `POST /users { teamId: 1, email: 'existing@domain.com' }` is a valid request, call `POST /users/validate { teamId: 1, email: 'existing@domain.com' }` first.

### Validations on GET

Core will use the yup schema to validate url parameters and query parameters. For example if your table has a `uuid` primary key column and you call `GET /table/abc`, the client will be sent:

```json
{
  "errors": {
    "id": "must be a valid UUID"
  }
}
```

## Graph Updates

To update several values at a time in a single transaction, you can include related tables in `POST` and `PUT` updates. For example:

```js
core.table({ tableName: "courses" });
core.table({ tableName: "assignments" });
// where a course has many assignments
```

You can create a `course` and many `assignments` at the same time:

```
POST /courses

{
  "name": "Course",
  "assignments": [
    {
      "name": "Assignment 1",
    },
    {
      "name": "Assignment 2",
    }
  ]
}
```

This works in the other direction as well. For example:

```js
core.table({ tableName: "epics" });
core.table({ tableName: "tasks" });
// where an epic has many tasks
```

You can create a task with an epic at the same time:

```
POST /tasks

{
  "name": "Course",
  "epic": {"slug": "epic-name"}
}
```

### Upserts

If a table has unique columns, you can specify that you would prefer Core to attempt an upsert.

```js
core.table({ tableName: "epics", allowUpserts: true });
core.table({ tableName: "tasks" });
// where an epic has many tasks
```

This way, if the epic with slug `epic-name` is already taken and visible in your policy, you can upsert to it:

```
POST /tasks

{
  "name": "Course",
  "epic": {"slug": "epic-name"}
}
```

### Complexity limits

By nature, graph upserts allow requests that may update many rows. To guard against abuse you can specify a complexity limit for Core and weight for a table.

```js
const core = new Core(
  (req, res) => {
    return {
      async getUser() {
        return await findUser(req.headers.authorization);
      },
    };
  },
  () => knex,
  { complexityLimit: 20 }
);

core.table({ tableName: "epics", complexityWeight: 2 });
core.table({ tableName: "tasks" });
```

This way, a request can update 20 rows, but each update to `epics` counts as two.

The default complexity limit is `100`. This is high so you would not run into the limit under normal use, but low enough that a malicious query has a limit.

## Tenant IDs

If your application has multiple accounts that do not interact with each other, it may be helpful to require a tenant ID on requests. Doing so paves the way for sharding on tenant ID through tools like Citus.

```js
core.table({ tableName: "tasks", tenantIdColumnName: "orgId" });
// now any request involving tasks requires a tenant id

app.use("/api/:orgId", core.router());
// optional, but you can specify the tenant id as a url param
// and it will be merged into the query parameters.
// query parameters win over url parameters.
```

All queries done by Core involving a table with a `tenantIdColumnName` will include the clause on the query. I.e. `where ?? = ?` with `[tenantIdColumnName, tenantId]`.

## Pagination

Core supports both offset and keyset pagination.

If you called `GET /items`, you may receive a response like this:

```json
{
  "meta": {
    "_links": {
      "count": "/items/count",
      "ids": "/items/ids",
      "nextPage": "/items?cursor={base64cursor}",
    },
    "_type": "items",
    "_url": "/test/items",
    "hasMore": true,
    "limit": 50,
    "page": 0,
  },
  "data": [...]
}
```

The `meta._links` property contains a link for the next page. To use keyset pagination, call the url at `nextPage`. To use offset pagination, specify a `page` as a query parameter: `/items?page=1`.

For both pagination schemes, you can specify a `limit` to limit the number of items in each response. The default limit is 50, and can be increased to 250.

## Counting

To get a count of rows in a collection, call `/:tableName/count`. You can add query parameters to count only matching rows: `/tasks/count?userId=1`.

## Getting IDs from a collection

To get a list of ids of rows in a collection, call `/:tableName/ids`. This endpoint returns 1,000 rows at a time and supports offset pagination. You can add query parameters to get ids for matching rows: `/tasks/ids?userId=1`.

## Default parameters

If you want to set a property when a table is created or updated, provide a `defaultParams` method.

```js
const core = new Core((req, res) => {
  return {
    async getUser() {
      return await findUser(req.headers.authorization);
    },
  };
});

core.table({
  tableName: "posts",
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
```
