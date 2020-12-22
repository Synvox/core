import { object, string, number, boolean, date, MixedSchema } from 'yup';

export function postgresTypesToYupType(type: string): MixedSchema<any> {
  /* istanbul ignore next */
  switch (type) {
    case 'bpchar':
    case 'char':
    case 'varchar':
    case 'text':
    case 'citext':
    case 'uuid':
    case 'bytea':
    case 'inet':
    case 'time':
    case 'timetz':
    case 'interval':
    case 'name':
      return string();
    case 'int2':
    case 'int4':
    case 'int8':
    case 'float4':
    case 'float8':
    case 'numeric':
    case 'money':
    case 'oid':
    case 'bigint':
    case 'integer':
      return number();
    case 'bool':
    case 'boolean':
      return boolean();
    case 'json':
    case 'jsonb':
      return object();
    case 'date':
    case 'timestamp':
    case 'timestamptz':
    case 'timestamp with time zone':
    case 'timestamp without time zone':
      return date();
    default:
      return string();
  }
}

export function postgresTypesToJSONTsTypes(type: string) {
  /* istanbul ignore next */
  switch (type) {
    case 'bpchar':
    case 'char':
    case 'varchar':
    case 'text':
    case 'citext':
    case 'uuid':
    case 'bytea':
    case 'inet':
    case 'time':
    case 'timetz':
    case 'interval':
    case 'name':
    case 'character varying':
    case 'timestamp with time zone':
    case 'timestamp without time zone':
    case 'date':
    case 'timestamp':
    case 'timestamptz':
      return 'string';
    case 'int2':
    case 'int4':
    case 'int8':
    case 'float4':
    case 'float8':
    case 'numeric':
    case 'money':
    case 'oid':
    case 'bigint':
    case 'int':
      return 'number';
    case 'bool':
    case 'boolean':
      return 'boolean';
    case 'json':
    case 'jsonb':
      return 'object';
    default:
      return 'any';
  }
}
