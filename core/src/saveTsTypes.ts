import { promises as fs } from "fs";
import { Table } from "./Table";
import { postgresTypesToJSONTsTypes } from "./lookups";

export async function saveTsTypes(
  tables: Table<any>[],
  path: string,
  includeLinks: boolean,
  includeRelations: boolean,
  includeParams: boolean
) {
  tables = tables.sort((a, b) => a.tablePath.localeCompare(b.tablePath));

  let types = "";

  for (let table of tables) {
    types += `export type ${table.className} = {\n`;
    const { columns } = table;

    for (let columnName in columns) {
      const column = columns[columnName];
      let type = column.type;
      let array = false;
      if (type.endsWith("[]")) {
        type = type.slice(0, -2);
        array = true;
      }

      let dataType = postgresTypesToJSONTsTypes(type);
      if (array) dataType += "[]";

      if (column.nullable) dataType += " | null";
      types += `  ${columnName}: ${dataType};\n`;
    }

    if (includeLinks) {
      types += `  _url: string;\n`;
      types += `  _type: string;\n`;
      types += `  _links: {\n`;

      const { hasOne, hasMany } = table.relatedTables;

      for (let [
        key,
        {
          relation: { columnName: column },
        },
      ] of Object.entries(hasOne)) {
        types += `    ${key}${columns[column].nullable ? "?" : ""}: string`;
        types += ";\n";
      }

      for (let key of Object.keys(hasMany)) {
        types += `    ${key}: string;\n`;
      }

      types += `  };\n`;
    }

    if (includeRelations) {
      const { hasOne, hasMany } = table.relatedTables;

      for (let [
        key,
        {
          relation: { columnName: column },
          table,
        },
      ] of Object.entries(hasOne)) {
        types += `  ${key}${columns[column].nullable ? "?" : ""}: ${
          table.className
        }`;
        types += ";\n";
      }

      for (let [key, { table }] of Object.entries(hasMany)) {
        types += `  ${key}: ${table.className}[];\n`;
      }

      for (let key of Object.keys(table.eagerGetters)) {
        types += `  ${key}: any;\n`;
      }

      for (let key of Object.keys(table.getters)) {
        types += `  ${key}: any;\n`;
      }
    }

    types += `};\n\n`;

    if (includeParams) {
      const paramTypeName = `${table.className}Params`;
      types += `export type ${paramTypeName} = Partial<{\n`;

      for (let columnName in columns) {
        const column = columns[columnName];
        let type = column.type;
        let array = false;

        if (type.endsWith("[]")) {
          type = type.slice(0, -2);
          array = true;
        }

        let dataType = postgresTypesToJSONTsTypes(type);
        const baseType = dataType;
        if (array) dataType += "[]";

        if (column.nullable) dataType += " | null";

        const ops = ["eq", "neq", "lt", "lte", "gt", "gte"];

        // select multiple ?id[]=1&id[]=2
        if (!array) dataType = `${dataType} | ${dataType}[]`;

        types += `  ${columnName}: ${dataType};\n`;

        if (baseType === "string") ops.push("like", "ilike");

        for (let op of ops) {
          types += `  "${columnName}.${op}": ${dataType};\n`;
        }
      }

      const ignoredSubs = ["include", "cursor", "page", "limit"];
      const queryModifierNames = Object.keys(table.queryModifiers);
      ignoredSubs.push(...queryModifierNames);

      for (let queryModifier of Object.keys(table.queryModifiers)) {
        types += `  ${queryModifier}: any;\n`;
      }

      const subTypeName = `Omit<${paramTypeName}, ${ignoredSubs
        .map((n) => `"${n}"`)
        .join(" | ")}>`;

      types += `  and: ${subTypeName};\n`;
      types += `  or: ${subTypeName};\n`;
      types += `  cursor: string;\n`;
      types += `  page: number;\n`;
      types += `  limit: number;\n`;

      const includable = [
        ...Object.keys(table.relatedTables.hasMany),
        ...Object.keys(table.relatedTables.hasOne),
        ...Object.keys(table.getters),
        ...Object.keys(table.eagerGetters),
      ];

      if (includable.length)
        types += `  include: (${includable
          .map((v) => `'${v}'`)
          .join(" | ")})[];\n`;

      types += `}>;\n\n`;
    }
  }

  await fs.writeFile(path, types.trim() + "\n");
}
