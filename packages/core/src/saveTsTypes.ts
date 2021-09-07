import { promises as fs } from "fs";
import { Table } from "./Table";
import { postgresTypesToJSONTsTypes } from "./lookups";
import { Column } from "./types";

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
    types += `declare module 'knex/types/tables' {\n`;
    types += `  interface Tables {\n`;
    for (let table of tables) {
      let type = `Knex.CompositeTableType<\n      ${table.className},\n      ${table.className}Insert,\n      ${table.className}Update\n    >`;

      if (table.schemaName === "public")
        types += `    "${table.tableName}": ${type};\n`;
      types += `    "${table.tablePath}": ${type};\n`;
    }
    types += `  }\n`;
    types += `}\n\n`;
  }

  types += `type Optional<T, K extends keyof T> = Omit<T, K> & Partial<T>;\n\n`;

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

    types +=
      "type SortParam<T> = Extract<keyof T, string> | `-${Extract<keyof T, string>}`\n\n";
  }

  for (let table of tables) {
    const { columns } = table;
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

    for (let columnName in columns) {
      const column = columns[columnName];

      const dataType =
        column.name === table.idColumnName
          ? `${table.className}Id`
          : getDataType(column);

      types += `  ${columnName}: ${dataType};\n`;
    }

    types += `};\n\n`;

    if (includeLinks) {
      const { hasOne, hasMany } = table.relatedTables;
      types += `export type ${table.className}Links = {\n`;
      types += `  _url: string;\n`;
      types += `  _type: string;\n`;
      types += `  _links: {\n`;

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
      types += `};\n\n`;
    }

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
        types += `  ${key}${columns[column].nullable ? "?" : ""}: ${
          table.className
        }`;
        types += ";\n";
      }

      types += `};\n\n`;

      types += `export type ${table.className}WriteRelations = `;
      const relations = [
        Object.values(hasOne).map(
          ({ name: key, relation: { columnName: column }, table }) => {
            let types = "";

            const nullable = columns[column].nullable;
            const required = !nullable && !columns[column].defaultValue;

            types += `{ ${key}: ${table.className}Write }`;
            types += ` | { ${column}${required ? "" : "?"}: ${
              table.className
            }Id ${nullable ? " | null" : ""}}`;

            return types;
          }
        ),
        Object.values(hasMany).map(({ name: key, table }) => {
          let types = "";

          types += `{ ${key}?: ${table.className}Write[] }`;

          return types;
        }),
      ]
        .reduce((a, b) => a.concat(b), [])
        .filter(Boolean)
        .map((s) => `(${s})`)
        .join("&  \n");
      if (relations) types += relations;
      else types += "{}";
      types += `;\n\n`;

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
      types += `};\n\n`;
    }

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
          baseType = `${table.className}Id`;
          baseType = `${baseType} | ${baseType}[]`;
        } else {
          if (columnName === table.idColumnName)
            baseType = `${table.className}Id`;
          else if (hasOne && hasOne.table === table) {
            baseType = `${hasOne.table.className}Id`;
          }

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
        ...Object.keys(table.relatedTables.hasMany).map((key) => `${key}Count`),
        ...Object.keys(table.relatedTables.hasOne),
        ...Object.keys(table.getters),
        ...Object.keys(table.eagerGetters),
      ];

      if (includeKeys.length) {
        const includeKeysStr = includeKeys.map((v) => `'${v}'`).join(" | ");
        let includeArrayType = `(${includeKeysStr})[]`;

        const relatedTables = [
          ...Object.values(table.relatedTables.hasMany),
          ...Object.values(table.relatedTables.hasOne),
        ];

        let includeObjStr = includeKeys
          .map((name) => {
            const ref = relatedTables.find((ref) => ref.name === name);
            let type = `${name}: true`;
            if (ref) type += ` | ${ref.table.className}Params['include']`;
            return type;
          })
          .join("; ");
        includeObjStr = `{ ${includeObjStr} }`;

        types += `    include: ${includeKeysStr} | ${includeArrayType} | ${includeObjStr};\n`;
      }

      types += `    sort: SortParam<${table.className}> | SortParam<${table.className}>[];\n`;
      types += `  };\n\n`;
    }

    const optionalFields = Object.values(table.columns)
      .filter(
        (c) =>
          c.nullable ||
          Boolean(c.defaultValue) ||
          // make has one relations optional
          Object.values(table.relatedTables.hasOne).some(
            (t) => t.relation.columnName === c.name
          )
      )
      .map((c) => JSON.stringify(c.name))
      .join(" | ");

    let writeType = `${table.className}Row`;

    let insertType = optionalFields.trim()
      ? `Optional<${writeType}, ${optionalFields}>`
      : table.className;

    let updateType = `Partial<${writeType}>`;
    if (includeRelations) {
      insertType += ` & ${table.className}WriteRelations`;
      updateType += ` & Partial<${table.className}WriteRelations>`;
    }

    if (includeLinks) {
      insertType += ` & {_url: never, _links: never, _type: never}`;
      updateType += ` & {_url: never, _links: never, _type: never}`;
    }

    let fullType = `${table.className}Row`;
    if (includeLinks) fullType += ` & ${table.className}Links`;
    if (includeRelations)
      fullType += ` & ${table.className}Relations & ${table.className}Getters`;

    types += `export type ${table.className} = ${fullType};\n`;
    types += `export type ${table.className}Insert = ${insertType};\n`;
    types += `export type ${table.className}Update = ${updateType};\n`;
    types += `export type ${table.className}Write = ${table.className}Insert | (${table.className}Update & { ${table.idColumnName}: ${table.className}Id });\n\n`;
    types += `export type ${table.className}Config = {\n`;
    types += `  item: ${table.className};\n`;
    types += `  row: ${table.className}Row;\n`;
    if (includeParams) types += `  params: ${table.className}Params;\n`;
    types += `  insert: ${table.className}Insert;\n`;
    types += `  update: ${table.className}Update;\n`;
    types += `  id: ${table.className}Id;\n`;
    types += `  idColumnName: "${table.idColumnName}";\n`;
    types += `}\n\n`;
  }

  const output = types.trim() + "\n";
  const existing = await fs.readFile(path).catch(() => "");
  if (output !== existing) await fs.writeFile(path, output);
}
