# `@synvox/core-client`

Core client provides an ergonomic interface for working with `@synvox/core`. It is not required when using `@synvox/core`.

## Using types

In your Core server, you may save TypeScript types for your database schema. like this:

```js
// on your server
if (process.env.NODE_ENV !== "production") {
  core.init().then(async () => {
    await core.saveTsTypes(
      path.resolve(__dirname, "/project/client/types.ts"),
      {
        includeRelations: true,
      }
    );
  });
}
```

`includeLinks: false` will tell Core server not to save `_links` and `_url` properties.

`includeRelations: true` will tell Core to save related tables as properties. For example, if you have a `posts` and a `comments` table, core might output something like:

```ts
type Post = {
  id: number;
  title: string;
  comments: Comment[];
};

type Comment = {
  id: number;
  body: string;
  post: Post;
};
```

`includeParams: true` will tell Core to save the query parameter options for a table.

```ts
type Post = {
  id: number;
  title: string;
  comments: Comment[];
};

type PostParams = {
  id: number;
  title: string;
  // more not shown
};

type Comment = {
  id: number;
  body: string;
  post: Post;
};

type CommentParams = {
  id: number;
  body: string;
  // more not shown
};
```

## Quick Start

Using the post and comments example, define your core schema and the routes each resource may be on.

```ts
import { core, table } from "@synvox/core-client";
import Axios from "axios";

const axios = Axios.create({ baseURL: "/api" });

const { useCore } = core(axios, {
  posts: table<Post, PostParams>("/posts"),
  comments: table<Comment, CommentParams>("/comments"),
});

export { useCore };
```

Then in your component:

```tsx
function Post({ postId }: { postId: number }) {
  const core = useCore();

  const post = core.posts(postId);
  // `post` will be of type `Post`
  // `postId` must be of type `PostParams['id']`

  return <>{post.name}</>;
}
```

_🎉 and Core will load that post into your component_. Internally this works similar to `React.lazy`. Core will manage an in-memory cache and suspend for data it needs.

Core provides hypermedia links (like `_url`, and `_links`). When core requests a collection like `/posts`, core will also cache the embedded rows like `/posts/1` and `/posts/2`. So if you have a component that does this:

```tsx
function Posts() {
  const core = useCore();

  const posts = core.posts();
  // posts will be assigned type `Post[]`

  return posts.map((post) => <Post key={post.id} postId={post.id} />);
}

function Post({ postId }: { postId: number }) {
  const core = useCore();

  const post = core.posts(postId);
  // post will be assigned type`Post`

  return <>{post.name}</>;
}
```

Then there will not be a separate request to get `/post/:id`. Core already has it in the cache from `/posts`. There's no need to load it a second time.

## The `useCore` hook

The `useCore` hook has suspending and non-suspending methods.

```tsx
const core = useCore()
// suspending
core.posts.get(id: PostParams['id'], params?: PostParams) // => Post
core.posts.get(params?: PostParams) // => Post[]
core.posts() // same as core.posts.get
core.first(params?: PostParams) // => Post
core.ids(params?: PostParams) // => Array<PostParams['id']>
core.count(params?: PostParams) // => number

// async
core.posts.post(data: Partial<Post> | Partial<Post>[], params?: Params) // => ChangeTo<Post[]>
core.posts.put(id: PostParams['id'], data: Partial<Post>, params?: Params) // => ChangeTo<Post>
core.posts.delete(id: PostParams['id'], params?: Params) // => ChangeTo<Post[]>
core.posts.post(url:string, data: Partial<Post> | Partial<Post>[], params?: Params) // => ChangeTo<Post[]>
// useful when calling something like `POST /users/:method`
```

## Resolving changes

The `ChangeTo` type includes an `update` method. After sending a request, call `update` to update all components that may have been changed by the request.

```tsx
async function saveComment() {
  const { update } = await core.comments.post({
    body: newPostBody,
  });

  await update();
}
```

Core will not automatically call update for you so you in case you need to change something before the components are updated, like redirect.

## Preloading

If you have a waterfall request that you would like to avoid, you can preload.

```tsx
import { preload } from "@synvox/core-client";

const { useCore } = core(axios, {
  item: table<Item, ItemParams>("/items"),
});

function Component() {
  const core = useCore();

  preload(() => core.items(1));
  preload(() => core.items(2));
}
```

This will load both `/items/1` and `/items/2`. Each `preload` call will return an async function that resolves the return value once it exists in the cache.

## Deferring

This is similar to preloading but instead of returning a promise, it will return `{data: T[] | undefined, isLoading: boolean}`. This makes it useful for sending requests that should not suspend.

```tsx
import { preload } from "@synvox/core-client";

const { useCore } = core(axios, {
  item: table<Item, ItemParams>("/items"),
});

function Component() {
  const core = useCore();

  const { data: user, isLoading } = suspend(() => {
    return core.users("me");
  });
}
```

## Cache Invalidation

In the case you need to invalidate cached urls, you can use the `touch` method.

```ts
const { useCore, touch } = core(axios, {
  posts: table<Post, PostParams>("/posts"),
  comments: table<Comment, CommentParams>("/comments"),
});

// then elsewhere...

await touch((url) => {
  // return true if you want to invalidate this url
  return url.startsWith("/posts") || url.startsWith("/comments");
});
```

Core will rerun the request that loaded that url and once all urls are loaded again, Core will update the components.

## Loading raw URLs

If you need to load a url into the cache manually, use the `useGetUrl` hook

```ts
const { useGetUrl } = core(axios, {
  item: table<Item, ItemParams>("/items"),
});

// then elsewhere...
const item = useGetUrl("/items/1");
```
