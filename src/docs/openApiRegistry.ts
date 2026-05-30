/**
 * OpenAPI registry & Swagger UI mount — Issue #929.
 *
 * The repo ships a hand-maintained `docs/openapi.yml` covering the public API.
 * This module loads that spec at startup and exposes two endpoints:
 *
 *   GET  /docs             → Swagger UI (browsable docs)
 *   GET  /docs/openapi.json → raw OpenAPI JSON
 *
 * Both are gated by `enabled` (default: not in production) so the docs aren't
 * served on prod unless an operator explicitly opts in. Callers wire it up in
 * `app.ts` via `mountOpenApiDocs(app)`.
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse as parseYaml } from 'yaml'
import type { Express, Request, Response, NextFunction } from 'express'
import swaggerUi from 'swagger-ui-express'

const HERE = path.dirname(fileURLToPath(import.meta.url))

/** Minimal shape of an OpenAPI document. The full spec is too large to type here. */
export interface OpenApiDocument {
  openapi: string
  info: {
    title: string
    version: string
    description?: string
  }
  paths: Record<string, Record<string, unknown>>
  components?: Record<string, unknown>
  tags?: Array<{ name: string; description?: string }>
}

/** Resolve the default spec path: backend/docs/openapi.yml. */
function defaultSpecPath(): string {
  // src/docs/openApiRegistry.ts → backend/
  return path.resolve(HERE, '..', '..', 'docs', 'openapi.yml')
}

/**
 * Load and parse the OpenAPI YAML spec. Throws a clear error if the spec is
 * missing, unparseable, or missing required fields.
 */
export function loadOpenApiSpec(specPath: string = defaultSpecPath()): OpenApiDocument {
  let raw: string
  try {
    raw = readFileSync(specPath, 'utf8')
  } catch (err) {
    throw new Error(
      `OpenAPI spec not found at ${specPath}: ${err instanceof Error ? err.message : String(err)}`,
    )
  }

  let parsed: unknown
  try {
    parsed = parseYaml(raw)
  } catch (err) {
    throw new Error(
      `OpenAPI spec at ${specPath} is not valid YAML: ${err instanceof Error ? err.message : String(err)}`,
    )
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new Error(`OpenAPI spec at ${specPath} did not parse to an object`)
  }

  const doc = parsed as Partial<OpenApiDocument>
  if (typeof doc.openapi !== 'string' || !doc.openapi.startsWith('3.')) {
    throw new Error(`OpenAPI spec at ${specPath} is missing a valid 3.x \`openapi\` version`)
  }
  if (!doc.info || typeof doc.info.title !== 'string') {
    throw new Error(`OpenAPI spec at ${specPath} is missing \`info.title\``)
  }
  if (!doc.paths || typeof doc.paths !== 'object') {
    throw new Error(`OpenAPI spec at ${specPath} is missing \`paths\``)
  }

  return doc as OpenApiDocument
}

export interface MountOpenApiDocsOptions {
  /**
   * Whether to actually serve the docs endpoints. Defaults to
   * `process.env.NODE_ENV !== 'production'`. Operators can pass `true`
   * explicitly to enable on prod (e.g. behind an admin auth check).
   */
  enabled?: boolean
  /** Override the docs base path. Defaults to `/docs`. */
  basePath?: string
  /** Override the spec path. Defaults to `backend/docs/openapi.yml`. */
  specPath?: string
  /**
   * Pre-route middleware (e.g. admin auth) inserted before Swagger UI. Use this
   * to require auth on production builds.
   */
  guard?: (req: Request, res: Response, next: NextFunction) => void
}

/**
 * Mount the documentation endpoints on the given Express app. Safe to call
 * unconditionally — when `enabled` is false this is a no-op.
 *
 * @returns `true` if the docs were mounted, `false` otherwise.
 */
export function mountOpenApiDocs(app: Express, options: MountOpenApiDocsOptions = {}): boolean {
  const enabled = options.enabled ?? process.env.NODE_ENV !== 'production'
  if (!enabled) return false

  const basePath = options.basePath ?? '/docs'
  const spec = loadOpenApiSpec(options.specPath)

  if (options.guard) {
    app.use(basePath, options.guard)
  }

  app.get(`${basePath}/openapi.json`, (_req, res) => {
    res.json(spec)
  })
  app.use(basePath, swaggerUi.serve, swaggerUi.setup(spec))

  return true
}

/**
 * Return the list of route groups covered by the loaded spec. Useful for
 * tests and for quick "does the spec cover X?" checks.
 */
export function listCoveredRouteGroups(spec: OpenApiDocument): string[] {
  const groups = new Set<string>()
  for (const route of Object.keys(spec.paths)) {
    const segments = route.split('/').filter(Boolean)
    if (segments.length === 0) continue
    // First segment of the path = the route group (api/auth, api/deals, …)
    const group = segments[0] === 'api' && segments.length > 1 ? segments[1] : segments[0]
    groups.add(group)
  }
  return Array.from(groups).sort()
}
