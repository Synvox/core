import { renderHook } from "@testing-library/react-hooks";
import { act } from "react-dom/test-utils";
import { createLoader, Cache } from "../src";

jest.useFakeTimers();

it("suspends and loads", async () => {
  let divideBy = 2;
  const cache = new Cache(async (num: number) => {
    if (divideBy === 0) throw new Error("Cannot divide by zero");
    return [
      [
        num,
        {
          value: num / divideBy,
          divideBy,
          num,
        },
      ],
    ];
  });

  const { useKey: useDivide, touch } = createLoader({ cache });
  let error: Error | null = null;
  let didSuspend: boolean = false;

  const { result, rerender, unmount, waitForNextUpdate } = renderHook(
    ({ num }: { num: number }) => {
      didSuspend = false;
      try {
        error = null;
        const divide = useDivide();
        const result = divide<{ value: string; a: number; b: number }>(num);
        return result;
      } catch (e) {
        if (e instanceof Error) {
          error = e;
          return null;
        } else {
          didSuspend = true;
          throw e;
        }
      }
    },
    { initialProps: { num: 4 } }
  );

  // suspends
  expect(didSuspend).toBe(true);
  expect(result.current).toMatchInlineSnapshot(`undefined`);
  await waitForNextUpdate();

  // first load
  expect(didSuspend).toBe(false);
  expect(result.current).toMatchInlineSnapshot(`
    Object {
      "divideBy": 2,
      "num": 4,
      "value": 2,
    }
  `);

  // change to another
  rerender({ num: 8 });
  expect(didSuspend).toBe(true);
  await waitForNextUpdate();
  expect(didSuspend).toBe(false);
  expect(result.current).toMatchInlineSnapshot(`
    Object {
      "divideBy": 2,
      "num": 8,
      "value": 4,
    }
  `);

  // remote change causing error
  divideBy = 0;
  await act(async () => await touch(() => true));
  expect(error).toMatchInlineSnapshot(`[Error: Cannot divide by zero]`);

  // remote change
  divideBy = 4;
  expect(didSuspend).toBe(false);
  await act(async () => await touch(() => true));
  expect(didSuspend).toBe(false);
  expect(result.current).toMatchInlineSnapshot(`
    Object {
      "divideBy": 4,
      "num": 8,
      "value": 2,
    }
  `);

  // change to another (stale) route
  expect(didSuspend).toBe(false);
  rerender({ num: 64 });
  expect(didSuspend).toBe(true);

  await waitForNextUpdate();
  expect(didSuspend).toBe(false);
  expect(result.current).toMatchInlineSnapshot(`
    Object {
      "divideBy": 4,
      "num": 64,
      "value": 16,
    }
  `);

  // cached values look good
  expect(cache.get(4)).toMatchInlineSnapshot(`
    Object {
      "data": undefined,
      "error": undefined,
      "promise": undefined,
      "subscribers": Set {},
    }
  `);
  expect(cache.get(64)).toMatchInlineSnapshot(`
    Object {
      "data": Object {
        "divideBy": 4,
        "num": 64,
        "value": 16,
      },
      "error": undefined,
      "promise": undefined,
      "refreshTimeout": undefined,
      "subscribers": Set {
        [Function],
      },
    }
  `);

  // cached value should disappear
  unmount();
  jest.runOnlyPendingTimers();

  expect(cache.get(4)).toMatchInlineSnapshot(`
    Object {
      "data": undefined,
      "error": undefined,
      "promise": undefined,
      "subscribers": Set {},
    }
  `);
});

it("preloads", async () => {
  const cache = new Cache(async (num: number) => {
    if (num === 0) throw new Error("I throw on zero");
    return [
      [
        num,
        {
          value: num * 2,
        },
      ],
    ];
  });

  const { preload, get: double } = createLoader({ cache });

  expect(
    await preload(() => {
      const { value: four } = double(2);
      return four;
    })
  ).toMatchInlineSnapshot(`4`);

  expect(cache.get(2)).toMatchInlineSnapshot(`
    Object {
      "data": Object {
        "value": 4,
      },
      "error": undefined,
      "promise": undefined,
      "refreshTimeout": undefined,
      "subscribers": Set {},
    }
  `);

  await expect(
    preload(() => {
      const { value: zero } = double(0);
      return zero;
    })
  ).rejects.toMatchInlineSnapshot(`[Error: I throw on zero]`);

  expect(cache.get(0)).toMatchInlineSnapshot(`
    Object {
      "data": undefined,
      "error": [Error: I throw on zero],
      "promise": undefined,
      "refreshTimeout": undefined,
      "subscribers": Set {},
    }
  `);
});
