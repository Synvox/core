import setValue from "set-value";
import { ValidationError, BaseSchema } from "yup";
import { ValidateOptions } from "yup/lib/types";
import { BadRequestError } from "./errors";

export async function validateAgainst<T>(
  schema: BaseSchema,
  graph: any,
  context: T,
  options: ValidateOptions<T> = {}
): Promise<[any, Record<string, string>]> {
  let errors: Record<string, any> = {};
  try {
    const castValue = await schema.validate(graph, {
      ...options,
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

    err.inner.forEach((e) => {
      let message = e.message;

      // replace paths[0].like[1].this
      // with paths.0.like.1.this
      const path = e
        .path!.replace(/\[([^[\]]+)\]/g, ".$1")
        .replace(/^[.]*|[.]*$/g, "");

      // remove the label from the start of the message
      // {firstName: 'firstName is required'} -> {firstName: 'is required'}
      const label: string = (e.params?.label as string) ?? e.path ?? "this";
      if (message.startsWith(label))
        message = message.slice(label.length).trim();

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
  const [castValue, errors] = await validateAgainst(schema, value, context, {
    stripUnknown: true,
  });

  if (Object.keys(errors).length > 0) throw new BadRequestError(errors);

  return castValue as T;
}
