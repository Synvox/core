import { promises as fs } from "fs";
import { OpenAPIV3 } from "openapi-types";
import { Table } from "./Table";
import { postgresTypesToJSONSchema } from "./lookups";
import { Column } from "./types";

const getTableName = (table: Table<any>) => table.className;
const getColumnName = (table: Table<any>, column: Column) =>
  `${getTableName(table)}.${column.name}`;

export async function saveOpenApi(tables: Table<any>[], path: string) {
  let json: OpenAPIV3.Document = JSON.parse(
    await fs.readFile(path, "utf-8").catch(() => "{}")
  );

  json.openapi = "3.0.3";
  json.info = {
    ...json.info,
    title: json?.info?.title ?? "",
    version: json?.info?.version ?? "",
  };

  json.paths = {
    ...json.paths,
  };

  tables.forEach((table) => {
    Object.assign(json.paths, generateRoutes(table, json));
  });

  json.components = {
    ...json.components,
    schemas: {
      ...json.components?.schemas,

      // Define tables
      ...Object.fromEntries(
        tables.map((table) => {
          const tableName = getTableName(table);
          const existingComponent =
            (json.components?.schemas?.[tableName] as OpenAPIV3.SchemaObject) ??
            {};

          const schema = {
            ...existingComponent,
            type: "object",
            properties: {
              ...existingComponent?.properties,
              ...Object.fromEntries(
                Object.values(table.columns).map((column) => {
                  return [
                    column.name,
                    {
                      $ref: `#/components/schemas/${getColumnName(
                        table,
                        column
                      )}`,
                    } as OpenAPIV3.ReferenceObject,
                  ];
                })
              ),
            },
          };

          return [tableName, schema] as [string, OpenAPIV3.SchemaObject];
        })
      ),

      // Define columns
      ...Object.fromEntries(
        tables
          .map((table) => {
            return Object.values(table.columns).map((column) => {
              const schemaName = getColumnName(table, column);
              const existingParam =
                (json.components?.schemas?.[
                  schemaName
                ] as OpenAPIV3.SchemaObject) ?? {};

              return [
                schemaName,
                {
                  ...existingParam,
                  type: postgresTypesToJSONSchema(column.type),
                  nullable: column.nullable,
                },
              ];
            });
          })
          .reduce((acc, item) => acc.concat(item), [])
      ),

      // Define Includes
      ...Object.fromEntries(
        tables.map((table) => {
          const schemaName = `${getTableName(table)}.includes`;
          const existingSchema =
            (json.components?.schemas?.[
              schemaName
            ] as OpenAPIV3.SchemaObject) ?? {};

          const items = [
            ...Object.keys(table.relatedTables.hasOne),
            ...Object.keys(table.relatedTables.hasMany),
            ...Object.keys(table.relatedTables.hasMany).map(
              (key) => `${key}Count`
            ),
            ...Object.keys(table.eagerGetters),
            ...Object.keys(table.getters),
          ];

          // can't use anyOf on the ui yet
          // https://github.com/swagger-api/swagger-ui/issues/3803
          const schema: OpenAPIV3.SchemaObject = {
            ...existingSchema,
            description: `Extra properties to eager load. Options include ${items
              .map((v) => JSON.stringify(v))
              .join(", ")}`,
            type: "array",
            items: {
              type: "string",
              enum: items,
            },
          };

          return [
            schemaName,
            items.length > 0 ? schema : { ...existingSchema, type: "string" },
          ];
        })
      ),

      // Define Sorts
      ...Object.fromEntries(
        tables.map((table) => {
          const schemaName = `${getTableName(table)}.sorts`;
          const existingSchema =
            (json.components?.schemas?.[
              schemaName
            ] as OpenAPIV3.SchemaObject) ?? {};

          const options = Object.values(table.columns)
            .map((column) => [`${column.name}`, `-${column.name}`])
            .reduce((acc, names) => acc.concat(names), []);

          // can't use anyOf on the ui yet
          // https://github.com/swagger-api/swagger-ui/issues/3803
          const schema: OpenAPIV3.SchemaObject = {
            ...existingSchema,
            description: `The property or properties to sort items by. Options include ${options
              .map((v) => JSON.stringify(v))
              .join(", ")}`,
            type: "array",
            items: {
              type: "string",
              enum: options,
            },
          };

          return [schemaName, schema];
        })
      ),
    },
    parameters: {
      ...json.components?.parameters,
      cursor: {
        ...json.components?.parameters?.["cursor"],
        name: "cursor",
        in: "query",
        required: false,
        schema: {
          type: "string",
        },
      },
      page: {
        ...json.components?.parameters?.["page"],
        name: "page",
        in: "query",
        required: false,
        schema: {
          type: "integer",
        },
      },
      limit: {
        ...json.components?.parameters?.["limit"],
        name: "limit",
        in: "query",
        required: false,
        schema: {
          type: "integer",
        },
      },

      ...Object.fromEntries(
        tables
          .map((table) => {
            return Object.values(table.columns).map((column) => {
              const parameterName = getColumnName(table, column);
              const existingParameter =
                (json.components?.parameters?.[
                  parameterName
                ] as OpenAPIV3.ParameterObject) ?? {};

              const parameter: OpenAPIV3.ParameterObject = {
                ...existingParameter,
                name: column.name,
                in: "query",
                style: "deepObject",
                schema: {
                  $ref: `#/components/schemas/${getColumnName(table, column)}`,
                },
              };

              return [parameterName, parameter];
            });
          })
          .reduce((acc, item) => acc.concat(item), [])
      ),

      ...Object.fromEntries(
        tables.map((table) => {
          const column = table.columns[table.idColumnName];

          const parameterName = `${getColumnName(table, column)}.path`;
          const existingParameter =
            (json.components?.parameters?.[
              parameterName
            ] as OpenAPIV3.ParameterObject) ?? {};

          const parameter: OpenAPIV3.ParameterObject = {
            ...existingParameter,
            name: column.name,
            in: "path",
            required: true,
            schema: {
              $ref: `#/components/schemas/${getColumnName(table, column)}`,
            },
          };

          return [parameterName, parameter];
        })
      ),

      ...Object.fromEntries(
        tables.map((table) => {
          const parameterName = `${getTableName(table)}.includes`;
          const existingParameter =
            (json.components?.parameters?.[
              parameterName
            ] as OpenAPIV3.ParameterObject) ?? {};

          const parameter: OpenAPIV3.ParameterObject = {
            ...existingParameter,
            name: "include",
            in: "query",
            style: "deepObject",
            schema: {
              $ref: `#/components/schemas/${getTableName(table)}.includes`,
            },
          };

          return [parameterName, parameter];
        })
      ),

      ...Object.fromEntries(
        tables.map((table) => {
          const parameterName = `${getTableName(table)}.sorts`;
          const existingParameter =
            (json.components?.parameters?.[
              parameterName
            ] as OpenAPIV3.ParameterObject) ?? {};

          const parameter: OpenAPIV3.ParameterObject = {
            ...existingParameter,
            name: "sort",
            in: "query",
            style: "deepObject",
            schema: {
              $ref: `#/components/schemas/${getTableName(table)}.sorts`,
            },
          };

          return [parameterName, parameter];
        })
      ),
    },
  };

  await fs.writeFile(path, JSON.stringify(json, null, 2) + "\n");
}

function generateRoutes(table: Table<any>, _json: OpenAPIV3.Document) {
  const params = Object.values(table.columns).map((column) => ({
    $ref: `#/components/parameters/${getColumnName(table, column)}`,
  }));

  const result: OpenAPIV3.PathsObject = {
    [`/${table.path}`]: {
      get: {
        tags: [table.className],
        parameters: [
          ...params,
          {
            $ref: `#/components/parameters/cursor`,
          },
          {
            $ref: `#/components/parameters/page`,
          },
          {
            $ref: `#/components/parameters/limit`,
          },
          {
            $ref: `#/components/parameters/${getTableName(table)}.sorts`,
          },
          {
            $ref: `#/components/parameters/${getTableName(table)}.includes`,
          },
        ],
        responses: {
          "200": {
            description: "Success",
            content: {
              "text/json": {
                schema: {
                  $ref: `#/components/schemas/${getTableName(table)}`,
                },
              },
            },
          },
        },
      },
      post: {
        tags: [table.className],
        responses: {
          "200": {
            description: "Success",
            content: {
              "text/json": {
                schema: {
                  $ref: `#/components/schemas/${getTableName(table)}`,
                },
              },
            },
          },
        },
      },
    },
    [`/${table.path}/first`]: {
      get: {
        tags: [table.className],
        parameters: [...params],
        responses: {
          "200": {
            description: "Success",
            content: {
              "text/json": {
                schema: {
                  $ref: `#/components/schemas/${getTableName(table)}`,
                },
              },
            },
          },
        },
      },
    },
    ...Object.fromEntries(
      Object.keys(table.idModifiers).map((name) => {
        return [
          `/${table.path}/${name}`,
          {
            get: {
              tags: [table.className],
              parameters: [...params],
              responses: {
                "200": {
                  description: "Success",
                  content: {
                    "text/json": {
                      schema: {
                        $ref: `#/components/schemas/${getTableName(table)}`,
                      },
                    },
                  },
                },
              },
            },
          },
        ];
      })
    ),
    [`/${table.path}/ids`]: {
      get: {
        tags: [table.className],
        parameters: [...params],
        responses: {
          "200": {
            description: "Success",
            content: {
              "text/json": {
                schema: {
                  type: "array",
                  items: {
                    type: postgresTypesToJSONSchema(
                      table.columns[table.idColumnName].type
                    ),
                  },
                },
              },
            },
          },
        },
      },
    },
    [`/${table.path}/count`]: {
      get: {
        tags: [table.className],
        parameters: [...params],
        responses: {
          "200": {
            description: "Success",
            content: {
              "text/json": {
                schema: {
                  type: "integer",
                },
              },
            },
          },
        },
      },
    },
    [`/${table.path}/{${table.idColumnName}}`]: {
      get: {
        tags: [table.className],
        parameters: [
          {
            $ref: `#/components/parameters/${getColumnName(
              table,
              table.columns[table.idColumnName]
            )}.path`,
          },
          ...params,
        ],
        responses: {
          "200": {
            description: "Success",
            content: {
              "text/json": {
                schema: {
                  $ref: `#/components/schemas/${getTableName(table)}`,
                },
              },
            },
          },
        },
      },
      put: {
        tags: [table.className],
        parameters: [
          {
            $ref: `#/components/parameters/${getColumnName(
              table,
              table.columns[table.idColumnName]
            )}.path`,
          },
        ],
        responses: {
          "200": {
            description: "Success",
            content: {
              "text/json": {
                schema: {
                  $ref: `#/components/schemas/${getTableName(table)}`,
                },
              },
            },
          },
        },
      },
      delete: {
        tags: [table.className],
        parameters: [
          {
            $ref: `#/components/parameters/${getColumnName(
              table,
              table.columns[table.idColumnName]
            )}.path`,
          },
        ],
        responses: {
          "200": {
            description: "Success",
            content: {
              "text/json": {
                schema: {
                  $ref: `#/components/schemas/${getTableName(table)}`,
                },
              },
            },
          },
        },
      },
    },
  };

  return result;
}
