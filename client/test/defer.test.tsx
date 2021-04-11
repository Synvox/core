import { renderHook } from "@testing-library/react-hooks";
import { createLoader, Cache } from "../src";

jest.useFakeTimers();

function isPromise(value: any) {
  return value && typeof value.then === "function";
}

export function defer<T>(call: () => T, defaultValue?: T) {
  try {
    return { data: call(), loading: false };
  } catch (e) {
    if (!isPromise(e)) throw e;

    return { data: defaultValue, loading: true };
  }
}

it("suspends and loads", async () => {
  let divideBy = 2;
  const cache = new Cache(async (num: number) => {
    if (divideBy === 0) throw new Error("Cannot divide by zero");
    await new Promise((r) => setImmediate(r, 50));
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

  const { useKey: useDivide } = createLoader({ cache });

  const { result, waitForNextUpdate } = renderHook(
    ({ num }: { num: number }) => {
      const divide = useDivide();
      const { data: result } = defer(() =>
        divide<{ value: string; a: number; b: number }>(num)
      );
      return result;
    },
    { initialProps: { num: 4 } }
  );

  expect(result.current).toMatchInlineSnapshot(`undefined`);
  await waitForNextUpdate();

  expect(result.current).toMatchInlineSnapshot(`
    Object {
      "divideBy": 2,
      "num": 4,
      "value": 2,
    }
  `);
});
