import { promises as fs } from "fs";
import { Table } from "./Table";
import { postgresTypesToJSONTsTypes } from "./lookups";
import { Column } from "./types";

export async function saveTsTypes(
  tables: Table<any>[],
  path: string,
  {
    includeRelations = false,
    includeKnex = false,
    useJsonTypes = true,
  }: {
    includeRelations?: boolean;
    includeKnex?: boolean;
    useJsonTypes?: boolean;
  } = {}
) {
  tables = tables.sort((a, b) => a.tablePath.localeCompare(b.tablePath));

  let types = "";

  if (includeKnex) {
    types += `import { Knex } from "knex";\n\n`;
    types += `type MaybeRaw<T> = {[K in keyof T]: T[K] | Knex.RawBuilder};`;
    types += `declare module 'knex/types/tables' {\n`;
    types += `  interface Tables {\n`;
    for (let table of tables) {
      let type = `Knex.CompositeTableType<\n      ${table.className}Row,\n      MaybeRaw<Partial<${table.className}Row>>,\n      MaybeRaw<Partial<${table.className}Row>>\n    >`;

      if (table.schemaName === "public")
        types += `    "${table.tableName}": ${type};\n`;
      types += `    "${table.tablePath}": ${type};\n`;
    }
    types += `  }\n`;
    types += `}\n\n`;
  }

  types += `type DeepPartial<T> = { [P in keyof T]?: DeepPartial<T[P]> };\n\n`;

  for (let table of tables) {
    let { columns: rawColumns } = table;

    const columns = Object.values(rawColumns).sort((a, b) =>
      a.name.localeCompare(b.name)
    );

    const idColumn = Object.values(columns).find(
      (column) => column.name === table.idColumnName
    )!;

    const getDataType = (column: Column) => {
      const columnName = column.name;
      let type = column.type;
      let array = false;
      if (type.endsWith("[]")) {
        type = type.slice(0, -2);
        array = true;
      }

      let dataType = "";
      const hasOne = Object.values(table.relatedTables.hasOne).find(
        (r) => r.relation.columnName === columnName
      );

      if (
        table.isLookupTable &&
        columnName === table.idColumnName &&
        table.lookupTableIds.length
      ) {
        dataType = table.lookupTableIds
          .map((id) => JSON.stringify(id))
          .join(" | ");
      } else if (
        hasOne &&
        hasOne.table.isLookupTable &&
        hasOne.table.lookupTableIds.length
      ) {
        dataType = hasOne.table.lookupTableIds
          .map((id) => JSON.stringify(id))
          .join(" | ");
      } else {
        dataType = postgresTypesToJSONTsTypes(type, useJsonTypes);
        if (array) dataType += "[]";
      }

      if (column.nullable) dataType += " | null";

      return dataType;
    };

    types += `export type ${table.className}Id = ${getDataType(idColumn)};\n`;
    types += `export type ${table.className}Row = {\n`;

    for (let column of columns) {
      const dataType =
        column.name === table.idColumnName
          ? `${table.className}Id`
          : getDataType(column);

      types += `  ${column.name}: ${dataType};\n`;
    }

    types += `};\n\n`;

    if (includeRelations) {
      const { hasOne, hasMany } = table.relatedTables;
      types += `export type ${table.className}Relations = {\n`;

      for (let [
        key,
        {
          relation: { columnName: column },
          table,
        },
      ] of Object.entries(hasOne)) {
        types += `  ${key}${rawColumns[column].nullable ? "?" : ""}: ${
          table.className
        }`;
        types += ";\n";
      }

      types += `};\n\n`;

      types += `export type ${table.className}Getters = {\n`;

      for (let [key, { table }] of Object.entries(hasMany)) {
        types += `  ${key}: ${table.className}[];\n`;
        types += `  ${key}Count: number;\n`;
      }

      for (let key of Object.keys(table.eagerGetters)) {
        types += `  ${key}: any;\n`;
      }

      for (let key of Object.keys(table.getters)) {
        types += `  ${key}: any;\n`;
      }

      for (let key of Object.keys(table.setters)) {
        types += `  ${key}: any;\n`;
      }

      types += `};\n\n`;
    }

    let fullType = `${table.className}Row`;
    if (includeRelations)
      fullType += ` & ${table.className}Relations & ${table.className}Getters`;

    types += `export type ${table.className} = ${fullType};\n`;
    types += `export type ${table.className}Config = {\n`;
    types += `  item: ${table.className};\n`;
    types += `  row: ${table.className}Row;\n`;
    types += `  insert: DeepPartial<${table.className}>;\n`;
    types += `  update: DeepPartial<${table.className}>;\n`;
    types += `  params: any;\n`;
    types += `  id: ${table.className}Id;\n`;
    types += `  idColumnName: "${table.idColumnName}";\n`;
    types += `}\n\n`;
  }

  const output = types.trim() + "\n";
  const existing = await fs.readFile(path).catch(() => "");
  if (output !== existing) await fs.writeFile(path, output);
}
