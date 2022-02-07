import { object, string, number, boolean, date, BaseSchema } from "yup";

/* istanbul ignore next */
export function postgresTypesToYupType(type: string): BaseSchema {
  switch (type) {
    case "uuid":
      return string().uuid();
    case "bpchar":
    case "char":
    case "varchar":
    case "text":
    case "citext":
    case "bytea":
    case "inet":
    case "time":
    case "timetz":
    case "interval":
    case "name":
      return string();
    case "int2":
    case "int4":
    case "int8":
    case "float4":
    case "float8":
    case "numeric":
    case "money":
    case "oid":
    case "bigint":
    case "integer":
    case "double precision":
      return number();
    case "bool":
    case "boolean":
      return boolean();
    case "json":
    case "jsonb":
      return object();
    case "date":
    case "timestamp":
    case "timestamptz":
    case "timestamp with time zone":
    case "timestamp without time zone":
      return date();
    default:
      return string();
  }
}

/* istanbul ignore next */
export function postgresTypesToJSONTsTypes(type: string, useJsonTypes = true) {
  switch (type) {
    case "timestamp with time zone":
    case "timestamp without time zone":
    case "date":
    case "timestamp":
    case "timestamptz":
      if (useJsonTypes) return "string";
      else return "Date";
    case "bpchar":
    case "char":
    case "varchar":
    case "text":
    case "citext":
    case "uuid":
    case "bytea":
    case "inet":
    case "time":
    case "timetz":
    case "interval":
    case "name":
    case "character varying":
      return "string";
    case "int2":
    case "int4":
    case "int8":
    case "float4":
    case "float8":
    case "numeric":
    case "money":
    case "oid":
    case "bigint":
    case "int":
    case "integer":
      return "number";
    case "bool":
    case "boolean":
      return "boolean";
    case "json":
    case "jsonb":
      return "any";
    default:
      return "any";
  }
}
