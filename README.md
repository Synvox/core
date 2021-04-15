# Core

Turn your postgres database into a restful api, and use that api on the client through a React hook.

Core comes in two parts:

- `@synvox/core` The Express middleware
- `@synvox/core-client` The React hook

## Why use Core

Core is an alternative to technologies like Firebase, Supabase, Parse Platform, Postgrest, Primsa, Graphile and others. These technologies are great and the inspiration for Core.

Unlike the alternatives, Core makes no assumptions about authentication. Firebase, and Supabase (and postgrest to a point), define how user management is done. When you need something slightly different, you may find yourself fighting the framework.

In Core, you define a piece of context that defines how an action is being requested. You can read cookies, or headers, or whatever you may need to define the metadata for a request. Core does not modify the `req` object.

```ts
// Core uses Knex for queries
const core = new Core(knex, (req, res) => {
  return {
    async getUser() {
      return await findUser(req.headers.authorization);
    },
  };
});
```

Core also does not make assumptions about authorization. Instead you can modify the query being sent to a table given the request context.

```ts
// users can read & write users with their user.id
core.table({
  tableName: "tasks",
  async policy(stmt, context, mode) {
    const user = await context.getUser();
    stmt.where(`tasks.id`, user.id);
  },
});
// now users can request these endpoints
// * GET /tasks
// * GET /tasks/:id
// * PUT /tasks/:id
// * POST /tasks/:id
// * DELETE /tasks/:id
// as well as these other helpful endpoints
// * GET /tasks/count
// * GET /tasks/ids
// * POST /tasks/validate
// * PUT /tasks/:id/validate
```

### Other features of the rest server:

- Core accepts query parameters for each column on the tables you declare. This way you can make queries like `GET /tasks?isComplete=true` out of the box.
- Core supports updating data as a graph. Graph updates have a customizable complexity limit to limit abuse. Updates happen in a transaction after the update is validated.
- Core supports selecting embedded resources to load with a request. This feature is helpful when reducing N+1 requests.
- Core validates requests using Yup and provides validation errors that can be shown to end users.
- Core supports making requests to a read replica and supports requiring a tenant id for tools like Citus.
- More

## Core Client

Core Server provides enough meta data for a really nice React hook for data loading. Instead of writing:

```tsx
const [user, setUser] = useState<User | null>(null);

useEffect(() => {
  async function loadUser() {
    const { data } = await axios.get(`/users/${userId}`);
    setUser(data);
  }

  loadUser();
}, [userId]);

if (!user) return <>Loading...</>;
```

You can write:

```jsx
const core = useCore();
const user = core.users(userId);
```

Which will trip the closest `<Suspense>` boundary. The client supports complex queries.

```jsx
const core = useCore();
const tasks = core.tasks({
  isActive: true,
  "name.fts": 'My Search'
  or: {
    isArchived: true
  }
});
```

This would request `/tasks?isActive=true&name.fts=My%20Search&or[isArchived]=true`
