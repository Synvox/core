import { promises as fs } from "fs";
import { Table } from "./Table";
import { postgresTypesToJSONTsTypes } from "./lookups";

export async function saveTsTypes(
  tables: Table<any>[],
  path: string,
  {
    includeLinks = false,
    includeRelations = false,
    includeParams = false,
    includeKnex = false,
    useJsonTypes = true,
  }: {
    includeLinks?: boolean;
    includeRelations?: boolean;
    includeParams?: boolean;
    includeKnex?: boolean;
    useJsonTypes?: boolean;
  } = {}
) {
  tables = tables.sort((a, b) => a.tablePath.localeCompare(b.tablePath));

  let types = "";

  if (includeKnex) {
    types += `import { Knex } from "knex";\n\n`;
    types += `type Optional<T, K extends keyof T> = Omit<T, K> & Partial<T>;\n\n`;
    types += `declare module 'knex/types/tables' {\n`;
    types += `  interface Tables {\n`;
    for (let table of tables) {
      const optionalFields = Object.values(table.columns)
        .filter((c) => c.nullable || Boolean(c.defaultValue))
        .map((c) => JSON.stringify(c.name))
        .join(" | ");
      const insertType = optionalFields.trim()
        ? `Optional<${table.className}, ${optionalFields}>`
        : table.className;
      const updateType = `Partial<${table.className}>`;
      let type = `Knex.CompositeTableType<\n      ${table.className},\n      ${insertType},\n      ${updateType}\n    >`;

      if (table.schemaName === "public")
        types += `    "${table.tableName}": ${type};\n`;
      types += `    "${table.tablePath}": ${type};\n`;
    }
    types += `  }\n`;
    types += `}\n\n`;
  }

  if (includeParams) {
    types += "type CollectionParams = {\n";
    types += `  cursor: string;\n`;
    types += `  page: number;\n`;
    types += `  limit: number;\n`;
    types += "};\n\n";

    types += `type ColumnParam<Name extends string, Type> = Record<\n`;
    types += `  | Name\n`;
    types += `  | \`\${Name}.not\`\n`;
    types += `  | \`\${Name}.eq\`\n`;
    types += `  | \`\${Name}.not.eq\`\n`;
    types += `  | \`\${Name}.neq\`\n`;
    types += `  | \`\${Name}.lt\`\n`;
    types += `  | \`\${Name}.not.lt\`\n`;
    types += `  | \`\${Name}.lte\`\n`;
    types += `  | \`\${Name}.not.lte\`\n`;
    types += `  | \`\${Name}.gt\`\n`;
    types += `  | \`\${Name}.not.gt\`\n`;
    types += `  | \`\${Name}.gte\`\n`;
    types += `  | \`\${Name}.not.gte\`,\n`;
    types += `  Type\n`;
    types += `> &\n`;
    types += `  (Type extends string ? Record<\`\${Name}.fts\`, Type> : {}) &\n`;
    types += `  (Type extends null ? Record<\`\${Name}.null\` | \`\${Name}.not.null\`, any> : {});\n\n`;
  }

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
        types += `  ${key}: unknown;\n`;
      }

      for (let key of Object.keys(table.getters)) {
        types += `  ${key}: unknown;\n`;
      }
    }

    types += `};\n\n`;

    if (includeParams) {
      const filtersType = `${table.className}Filters`;
      const paramsType = `${table.className}Params`;
      types += `export type ${filtersType} = `;

      const columnTypes: string[] = [];

      for (let columnName in columns) {
        const column = columns[columnName];
        let type = column.type;
        let array = false;

        if (type.endsWith("[]")) {
          type = type.slice(0, -2);
          array = true;
        }

        const ops = ["eq", "neq", "lt", "lte", "gt", "gte"];
        let baseType = postgresTypesToJSONTsTypes(type);

        const hasOne = Object.values(table.relatedTables.hasOne).find(
          (r) => r.relation.columnName === columnName
        );
        if (
          table.isLookupTable &&
          columnName === table.idColumnName &&
          table.lookupTableIds.length
        ) {
          baseType = table.lookupTableIds
            .map((id) => JSON.stringify(id))
            .join(" | ");
          baseType = `(${baseType})`;
        } else if (hasOne && hasOne.table !== table) {
          baseType = hasOne.table.lookupTableIds
            .map((id) => JSON.stringify(id))
            .join(" | ");
          baseType = `${hasOne.table.className}Filters['${hasOne.table.idColumnName}']`;
        } else {
          if (baseType === "string") ops.push("fts");
          if (array) baseType += "[]";
          else baseType = `${baseType} | ${baseType}[]`;
        }

        if (column.nullable) baseType += " | null";

        columnTypes.push(`ColumnParam<"${columnName}", ${baseType}>`);
      }

      types += columnTypes.join(" &\n  ");

      types += ` & {\n`;
      for (let { table: relatedTable, name } of Object.values(
        table.relatedTables.hasOne
      )) {
        const filtersType = `${relatedTable.className}Filters`;
        types += `    ${name}: ${filtersType};\n`;
        types += `    "${name}.not": ${filtersType};\n`;
      }

      types += `    and: ${filtersType} | ${filtersType}[];\n`;
      types += `    "not.and": ${filtersType} | ${filtersType}[];\n`;
      types += `    or: ${filtersType} | ${filtersType}[];\n`;
      types += `    "not.or": ${filtersType} | ${filtersType}[];\n`;
      types += `  };\n\n`;

      let filterTypeNameWithIdModifiers = filtersType;
      const idModifierTypes = Object.keys(table.idModifiers)
        .map((name) => JSON.stringify(name))
        .join(" | ");

      if (idModifierTypes) {
        filterTypeNameWithIdModifiers = `(${filtersType} | { ${table.idColumnName}: ${idModifierTypes} })`;
      }

      types += `export type ${paramsType} = ${filterTypeNameWithIdModifiers} &\n`;
      types += `  CollectionParams & {\n`;

      for (let queryModifier of Object.keys(table.queryModifiers)) {
        types += `    ${queryModifier}: unknown;\n`;
      }

      const includeKeys = [
        ...Object.keys(table.relatedTables.hasMany),
        ...Object.keys(table.relatedTables.hasOne),
        ...Object.keys(table.getters),
        ...Object.keys(table.eagerGetters),
      ];

      if (includeKeys.length) {
        let includeType = includeKeys.map((v) => `'${v}'`).join(" | ");
        if (includeKeys.length > 1) includeType = `(${includeType})`;
        types += `    include: ${includeType}[];\n`;
      }

      const sortType = Object.keys(table.columns)
        .map((name) => [name, `-${name}`])
        .reduce((acc, c) => acc.concat(c), [])
        .map((v) => `'${v}'`)
        .join(" | ");

      types += `    sort: ${sortType} | (${sortType})[];\n`;
      types += `  };\n\n`;
    }
  }

  await fs.writeFile(path, types.trim() + "\n");
}
