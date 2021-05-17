import { renderHook } from '@testing-library/react-hooks';
import { createLoader, Cache } from '../src';

jest.useFakeTimers();

it('works with object keys', async () => {
  class Query {
    urlBase: string;
    id?: string;
    constructor(id: string) {
      this.id = id;
      this.urlBase = '';
    }
    async run() {
      return { url: `${this.urlBase}/${this.id}`, id: this.id };
    }
  }

  type User = {
    id: string;
    url: string;
  };

  class UserQuery extends Query {
    urlBase = '/users';
  }

  const cache = new Cache(async (query: Query) => [[query, await query.run()]]);

  const { useKey: useGet } = createLoader({ cache });
  const query = new UserQuery('1');

  const { result, waitForNextUpdate } = renderHook(
    () => {
      const get = useGet();
      return get<User>(query);
    },
    { initialProps: { num: 4 } }
  );

  // suspends
  expect(result.current).toMatchInlineSnapshot(`undefined`);
  await waitForNextUpdate();

  // first load
  expect(result.current).toMatchInlineSnapshot(`
    Object {
      "id": "1",
      "url": "/users/1",
    }
  `);
});
