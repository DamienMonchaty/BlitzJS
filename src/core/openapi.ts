import type { StandardSchemaV1 } from '@standard-schema/spec';
import type { BlitzJS } from './BlitzJS.js';
import { RouteInfo } from './types.js';

export interface OpenApiInfo {
  title: string;
  version: string;
  description?: string;
}

export interface OpenApiServer {
  url: string;
  description?: string;
}

export type ToJsonSchema = (schema: StandardSchemaV1) => Record<string, unknown> | Promise<Record<string, unknown>>;

export interface OpenApiOptions {
  servers?: OpenApiServer[];
  /**
   * Converts a Standard Schema validator to a JSON Schema object. Only
   * needed to override the built-in auto-detection (based on the schema's
   * `~standard.vendor`) - zod v4 and arktype work with zero config; valibot
   * needs its own `@valibot/to-json-schema` package installed. Pass this to
   * support another validator, or to swap in your own conversion.
   */
  toJsonSchema?: ToJsonSchema;
}

const jsonSchemaConverters: Partial<Record<string, ToJsonSchema>> = {};

/** Best-effort Standard Schema -> JSON Schema conversion, dispatched by the schema's `~standard.vendor`. */
async function defaultToJsonSchema(schema: StandardSchemaV1): Promise<Record<string, unknown>> {
  const vendor = schema['~standard'].vendor;
  const cached = jsonSchemaConverters[vendor];
  if (cached) return cached(schema);

  try {
    let converter: ToJsonSchema | undefined;

    if (vendor === 'zod') {
      const specifier = 'zod';
      const zod = await import(specifier);
      converter = (s) => (zod as unknown as { toJSONSchema: ToJsonSchema }).toJSONSchema(s);
    } else if (vendor === 'valibot') {
      const specifier = '@valibot/to-json-schema';
      const toJsonSchemaPkg = await import(specifier);
      converter = (s) => (toJsonSchemaPkg as unknown as { toJsonSchema: ToJsonSchema }).toJsonSchema(s);
    } else if (typeof (schema as unknown as { toJsonSchema?: () => Record<string, unknown> }).toJsonSchema === 'function') {
      // arktype schemas expose this directly on the instance.
      converter = (s) => (s as unknown as { toJsonSchema: () => Record<string, unknown> }).toJsonSchema();
    }

    if (!converter) return {};
    jsonSchemaConverters[vendor] = converter;
    return await converter(schema);
  } catch {
    return {};
  }
}

async function resolveJsonSchema(schema: StandardSchemaV1, toJsonSchema?: ToJsonSchema): Promise<Record<string, unknown>> {
  return toJsonSchema ? toJsonSchema(schema) : defaultToJsonSchema(schema);
}

function toOpenApiPath(pattern: string): string {
  return pattern.replace(/:([A-Za-z0-9_]+)/g, '{$1}');
}

async function buildParameters(route: RouteInfo, toJsonSchema?: ToJsonSchema): Promise<Record<string, unknown>[]> {
  const paramProperties = route.schema?.params
    ? ((await resolveJsonSchema(route.schema.params, toJsonSchema)) as { properties?: Record<string, unknown> }).properties ?? {}
    : {};

  const parameters: Record<string, unknown>[] = route.paramNames.map((name) => ({
    name,
    in: 'path',
    required: true,
    schema: paramProperties[name] ?? { type: 'string' }
  }));

  if (route.schema?.query) {
    const jsonSchema = (await resolveJsonSchema(route.schema.query, toJsonSchema)) as { properties?: Record<string, unknown>; required?: string[] };
    for (const [name, propSchema] of Object.entries(jsonSchema.properties ?? {})) {
      parameters.push({ name, in: 'query', required: jsonSchema.required?.includes(name) ?? false, schema: propSchema });
    }
  }

  return parameters;
}

async function buildRequestBody(route: RouteInfo, toJsonSchema?: ToJsonSchema): Promise<Record<string, unknown> | undefined> {
  if (!route.schema?.body) return undefined;

  return {
    required: true,
    content: {
      'application/json': {
        schema: await resolveJsonSchema(route.schema.body, toJsonSchema)
      }
    }
  };
}

function buildResponses(route: RouteInfo): Record<string, unknown> {
  const responses: Record<string, unknown> = { '200': { description: 'Successful response' } };

  if (route.schema?.params || route.schema?.query || route.schema?.body) {
    responses['400'] = {
      description: 'Validation error',
      content: {
        'application/json': {
          schema: {
            type: 'object',
            properties: { error: { type: 'string' }, issues: { type: 'array', items: { type: 'object' } } }
          }
        }
      }
    };
  }

  return { ...responses, ...route.schema?.openapi?.responses };
}

/**
 * Build an OpenAPI 3.2 document (https://spec.openapis.org/oas/v3.2.0.html)
 * from a BlitzJS app's registered routes. BlitzJS doesn't serve or render
 * it itself - expose it however fits your project, e.g.:
 *
 * ```ts
 * const doc = await generateOpenApiDocument(app, { title: 'My API', version: '1.0.0' });
 * app.get('/openapi.json', () => doc);
 * ```
 *
 * then point swagger-ui, Redoc, or any other OpenAPI tooling at that route.
 */
export async function generateOpenApiDocument(app: BlitzJS, info: OpenApiInfo, options: OpenApiOptions = {}): Promise<Record<string, unknown>> {
  const paths: Record<string, Record<string, unknown>> = {};

  for (const route of app.getRoutes()) {
    const path = toOpenApiPath(route.pattern);
    const pathItem = paths[path] ?? (paths[path] = {});

    pathItem[route.method] = {
      operationId: route.schema?.openapi?.operationId,
      summary: route.schema?.openapi?.summary,
      description: route.schema?.openapi?.description,
      tags: route.schema?.openapi?.tags,
      deprecated: route.schema?.openapi?.deprecated,
      parameters: await buildParameters(route, options.toJsonSchema),
      requestBody: await buildRequestBody(route, options.toJsonSchema),
      responses: buildResponses(route)
    };
  }

  return {
    openapi: '3.2.0',
    info,
    ...(options.servers ? { servers: options.servers } : {}),
    paths
  };
}
