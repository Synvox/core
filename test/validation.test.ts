import { validate } from "../src";
import { string, object } from "yup";

describe("validation", () => {
  it("validates basic", async () => {
    const cast = await validate<{ prop: string }>(object({ prop: string() }), {
      prop: 1,
    });

    expect(cast).toMatchInlineSnapshot(`
      Object {
        "prop": "1",
      }
    `);
  });

  it("validates basic (failure)", async () => {
    const cast = await validate(object({ prop: string() }), { prop: [] }).catch(
      (e) => e.body
    );
    expect(cast).toMatchInlineSnapshot(`
      Object {
        "errors": Object {
          "prop": "must be a \`string\` type, but the final value was: \`[]\`.",
        },
      }
    `);
  });
});
