import { validate } from "../src";
import { string, object } from "yup";

describe("validation", () => {
  it("validates basic", async () => {
    const cast = await validate<{ prop: string }>(object({ prop: string() }), {
      prop: 1,
      key: 0,
    });

    expect(cast).toMatchInlineSnapshot(`
      Object {
        "prop": "1",
      }
    `);
  });

  it("validates basic (failure)", async () => {
    const cast = await validate(object({ prop: string() }), {
      prop: [],
      key: 0,
    }).catch((e) => e.body);
    expect(cast).toMatchInlineSnapshot(`
      Object {
        "errors": Object {
          "prop": "must be a \`string\` type, but the final value was: \`[]\`.",
        },
      }
    `);
  });

  it("validates custom with label", async () => {
    const cast = await validate(
      object({ prop: string().test("test", "did fail", () => false) }),
      {
        prop: "",
      }
    ).catch((e) => e.body);
    expect(cast).toMatchInlineSnapshot(`
      Object {
        "errors": Object {
          "prop": "did fail",
        },
      }
    `);
  });

  it("validates deep", async () => {
    const cast = await validate<{ prop: string }>(
      object({ prop: object({ prop: string() }) }),
      {
        prop: { prop: 1, key: 0 },
      }
    );

    expect(cast).toMatchInlineSnapshot(`
      Object {
        "prop": Object {
          "prop": "1",
        },
      }
    `);
  });

  it("validates nested (failure)", async () => {
    const cast = await validate(object({ prop: object({ prop: string() }) }), {
      prop: { prop: [], key: 0 },
    }).catch((e) => e.body);
    expect(cast).toMatchInlineSnapshot(`
      Object {
        "errors": Object {
          "prop": Object {
            "prop": "must be a \`string\` type, but the final value was: \`[]\`.",
          },
        },
      }
    `);
  });
});
