import setValue from "set-value";
import { ValidationError, BaseSchema } from "yup";
import { BadRequestError } from "./errors";

export async function validateAgainst<T>(
  schema: BaseSchema,
  graph: any,
  context: T
): Promise<[any, Record<string, string>]> {
  let errors: Record<string, any> = {};
  try {
    const castValue = await schema.validate(graph, {
      abortEarly: false,
      strict: false,
      context,
    });

    return [castValue, {}];
  } catch (err) {
    // in case a validator crashes we want to surface that through express
    /* istanbul ignore next */
    if (!(err instanceof ValidationError)) {
      throw err;
    }

    err.inner
      .map((e) => {
        const REPLACE_BRACKETS = /\[([^[\]]+)\]/g;
        const LFT_RT_TRIM_DOTS = /^[.]*|[.]*$/g;
        const dotPath = e
          .path!.replace(REPLACE_BRACKETS, ".$1")
          .replace(LFT_RT_TRIM_DOTS, "");

        return {
          path: dotPath,
          message: e.message.slice(e.message.indexOf(" ")).trim(),
        };
      })
      .forEach(({ message, path }) => {
        setValue(errors, path, message);
      });

    return [graph, errors];
  }
}

export async function validate<T>(
  schema: BaseSchema,
  value: any,
  context?: any
) {
  const [castValue, errors] = await validateAgainst(schema, value, context);

  if (Object.keys(errors).length > 0) throw new BadRequestError({ errors });

  return castValue as T;
}
