import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import express from 'express'
import request from 'supertest'

import {
  loadOpenApiSpec,
  mountOpenApiDocs,
  listCoveredRouteGroups,
  type OpenApiDocument,
} from './openApiRegistry'

function makeTempSpec(spec: string): { dir: string; specPath: string } {
  const dir = mkdtempSync(join(tmpdir(), 'openapi-test-'))
  const specPath = join(dir, 'openapi.yml')
  writeFileSync(specPath, spec, 'utf8')
  return { dir, specPath }
}

const VALID_SPEC = `openapi: 3.0.3
info:
  title: ShelterFlex Test API
  version: 0.0.0
paths:
  /api/auth/login:
    post:
      summary: Login
      responses:
        '200':
          description: ok
  /api/deals/{id}:
    get:
      summary: Get deal
      responses:
        '200':
          description: ok
  /api/payments/initiate:
    post:
      summary: Initiate payment
      responses:
        '200':
          description: ok
`

describe('loadOpenApiSpec', () => {
  let temp: { dir: string; specPath: string }
  beforeEach(() => {
    temp = makeTempSpec(VALID_SPEC)
  })
  afterEach(() => {
    rmSync(temp.dir, { recursive: true, force: true })
  })

  it('parses a valid OpenAPI 3 YAML file', () => {
    const spec = loadOpenApiSpec(temp.specPath)
    expect(spec.openapi).toMatch(/^3\./)
    expect(spec.info.title).toBe('ShelterFlex Test API')
    expect(Object.keys(spec.paths)).toContain('/api/auth/login')
  })

  it('throws a clear error when the file is missing', () => {
    expect(() => loadOpenApiSpec(join(temp.dir, 'does-not-exist.yml'))).toThrow(
      /OpenAPI spec not found/,
    )
  })

  it('throws when the YAML is malformed', () => {
    const broken = makeTempSpec(': : not yaml [\n  - oops')
    try {
      expect(() => loadOpenApiSpec(broken.specPath)).toThrow(/not valid YAML/)
    } finally {
      rmSync(broken.dir, { recursive: true, force: true })
    }
  })

  it('throws when the openapi version is missing', () => {
    const noVersion = makeTempSpec('info:\n  title: x\npaths: {}\n')
    try {
      expect(() => loadOpenApiSpec(noVersion.specPath)).toThrow(/openapi/)
    } finally {
      rmSync(noVersion.dir, { recursive: true, force: true })
    }
  })

  it('loads the repo spec at the default path without throwing', () => {
    // Smoke test: makes sure docs/openapi.yml stays valid as the repo evolves.
    const spec = loadOpenApiSpec()
    expect(spec.openapi).toMatch(/^3\./)
    expect(Object.keys(spec.paths).length).toBeGreaterThan(0)
  })
})

describe('listCoveredRouteGroups', () => {
  it('extracts the top-level groups from the loaded spec', () => {
    const spec: OpenApiDocument = {
      openapi: '3.0.3',
      info: { title: 't', version: '0' },
      paths: {
        '/api/auth/login': { post: {} },
        '/api/deals': { get: {} },
        '/api/deals/{id}': { get: {} },
        '/health': { get: {} },
      },
    }
    expect(listCoveredRouteGroups(spec)).toEqual(['auth', 'deals', 'health'])
  })
})

describe('mountOpenApiDocs', () => {
  let temp: { dir: string; specPath: string }
  beforeEach(() => {
    temp = makeTempSpec(VALID_SPEC)
  })
  afterEach(() => {
    rmSync(temp.dir, { recursive: true, force: true })
  })

  it('returns false and mounts nothing when enabled=false', async () => {
    const app = express()
    const mounted = mountOpenApiDocs(app, { enabled: false, specPath: temp.specPath })
    expect(mounted).toBe(false)
    const res = await request(app).get('/docs/openapi.json')
    expect(res.status).toBe(404)
  })

  it('defaults to enabled when NODE_ENV is not "production"', async () => {
    const old = process.env.NODE_ENV
    process.env.NODE_ENV = 'development'
    try {
      const app = express()
      const mounted = mountOpenApiDocs(app, { specPath: temp.specPath })
      expect(mounted).toBe(true)
    } finally {
      process.env.NODE_ENV = old
    }
  })

  it('defaults to disabled when NODE_ENV === "production"', () => {
    const old = process.env.NODE_ENV
    process.env.NODE_ENV = 'production'
    try {
      const app = express()
      const mounted = mountOpenApiDocs(app, { specPath: temp.specPath })
      expect(mounted).toBe(false)
    } finally {
      process.env.NODE_ENV = old
    }
  })

  it('serves the raw spec at /docs/openapi.json', async () => {
    const app = express()
    mountOpenApiDocs(app, { enabled: true, specPath: temp.specPath })
    const res = await request(app).get('/docs/openapi.json')
    expect(res.status).toBe(200)
    expect(res.body.openapi).toBe('3.0.3')
    expect(res.body.info.title).toBe('ShelterFlex Test API')
  })

  it('runs the guard middleware before serving docs', async () => {
    const guard = vi.fn((_req, res, _next) => res.status(401).json({ error: 'auth required' }))
    const app = express()
    mountOpenApiDocs(app, { enabled: true, specPath: temp.specPath, guard })
    const res = await request(app).get('/docs/openapi.json')
    expect(res.status).toBe(401)
    expect(guard).toHaveBeenCalled()
  })

  it('respects a custom basePath', async () => {
    const app = express()
    mountOpenApiDocs(app, { enabled: true, specPath: temp.specPath, basePath: '/api-docs' })
    const res = await request(app).get('/api-docs/openapi.json')
    expect(res.status).toBe(200)
  })
})
