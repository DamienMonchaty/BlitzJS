import { BlitzJS, PluginFunction } from './BlitzJS.js';
import { generateOpenApiDocument, OpenApiInfo, OpenApiServer, OpenApiOptions } from './openapi.js';
import { staticFile } from './static-file.js';
import { joinRuntimePath } from './platform.js';

export interface SwaggerOptions {
  info?: Partial<OpenApiInfo>;
  /** Interactive docs UI path. Default `/docs`. */
  path?: string;
  /** Raw JSON spec path. Default `/openapi.json`. */
  specPath?: string;
  servers?: OpenApiServer[];
  toJsonSchema?: OpenApiOptions['toJsonSchema'];
  /** Routes to omit from the generated spec, matched against their OpenAPI path (e.g. `/user/{id}`) */
  exclude?: string | RegExp | (string | RegExp)[];
  /**
   * Extra OpenAPI document fields merged on top of the generated one -
   * security schemes, global `tags`, `components`, or manually-added
   * `paths` entries the router doesn't know about.
   */
  documentation?: Record<string, unknown>;
}

function isExcluded(openApiPath: string, exclude: SwaggerOptions['exclude']): boolean {
  if (!exclude) return false;
  const patterns = Array.isArray(exclude) ? exclude : [exclude];
  return patterns.some((pattern) => (typeof pattern === 'string' ? pattern === openApiPath : pattern.test(openApiPath)));
}

let cachedSwaggerUiDir: string | undefined;

async function resolveSwaggerUiDir(): Promise<string> {
  if (cachedSwaggerUiDir) return cachedSwaggerUiDir;

  try {
    const specifier = 'swagger-ui-dist/absolute-path.js';
    const mod = await import(specifier);
    cachedSwaggerUiDir = (mod.default as () => string)();
    return cachedSwaggerUiDir;
  } catch {
    throw new Error("swagger() plugin needs 'swagger-ui-dist' - run `npm install --save-dev swagger-ui-dist`.");
  }
}

function renderDocsHtml(specPath: string, cssPath: string, bundlePath: string): string {
  return `<!DOCTYPE html>
<html>
<head>
  <title>API Docs</title>
  <link rel="stylesheet" href="${cssPath}" />
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="${bundlePath}"></script>
  <script>window.ui = SwaggerUIBundle({ url: ${JSON.stringify(specPath)}, dom_id: '#swagger-ui' });</script>
</body>
</html>`;
}

/**
 * Elysia-style plugin: `.use(swagger())` builds an OpenAPI 3.2 document from
 * the app's own registered routes (via `generateOpenApiDocument`) and serves
 * it alongside a self-hosted swagger-ui page - no CDN, works offline.
 *
 * Requires `swagger-ui-dist` as a project dependency (`npm install
 * --save-dev swagger-ui-dist`) - not bundled with BlitzJS itself, to keep
 * the framework's own dependency footprint at zero. Only loaded lazily on
 * the first request to the docs/asset routes, so apps that never register
 * this plugin never pay for it.
 */
export function swagger(options: SwaggerOptions = {}): PluginFunction {
  const docsPath = options.path ?? '/docs';
  const specPath = options.specPath ?? '/openapi.json';
  const cssPath = `${docsPath}/swagger-ui.css`;
  const bundlePath = `${docsPath}/swagger-ui-bundle.js`;

  return (app) => {
    app.get(specPath, async () => {
      const doc = await generateOpenApiDocument(
        app,
        { title: 'API', version: '1.0.0', ...options.info },
        { servers: options.servers, toJsonSchema: options.toJsonSchema }
      );

      // Don't list the docs/spec/asset routes the plugin itself just registered,
      // or anything the caller asked to hide via `exclude`.
      const paths = doc.paths as Record<string, unknown>;
      for (const key of Object.keys(paths)) {
        const isOwnRoute = key === specPath || key === docsPath || key.startsWith(`${docsPath}/`);
        if (isOwnRoute || isExcluded(key, options.exclude)) delete paths[key];
      }

      return {
        ...doc,
        ...options.documentation,
        paths: { ...paths, ...(options.documentation?.paths as Record<string, unknown> | undefined) }
      };
    });

    app.get(docsPath, (ctx) => {
      ctx.res.writeHeader('Content-Type', 'text/html; charset=utf-8');
      ctx.res.end(renderDocsHtml(specPath, cssPath, bundlePath));
    });

    app.get(cssPath, async (ctx) => {
      const dir = await resolveSwaggerUiDir();
      await staticFile(await joinRuntimePath(dir, 'swagger-ui.css'))(ctx);
    });

    app.get(bundlePath, async (ctx) => {
      const dir = await resolveSwaggerUiDir();
      await staticFile(await joinRuntimePath(dir, 'swagger-ui-bundle.js'))(ctx);
    });
  };
}
