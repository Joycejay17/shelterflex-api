import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import express, { type Express } from 'express'
import { createAdminRolesRouter } from './adminRoles.js'
import { sessionStore, userStore } from '../models/authStore.js'
import { errorHandler } from '../middleware/errorHandler.js'
import { getPool } from '../db.js'

describe('Admin Roles RBAC Routes', () => {
  let app: Express
  let authToken: string
  let superUserId: string
  let regularUserId: string

  beforeEach(async () => {
    userStore.clear()
    sessionStore.clear()

    // 1. Create a super_admin user
    const superUser = await userStore.getOrCreateByEmail('superadmin@test.com')
    superUserId = superUser.id
    superUser.role = 'super_admin' // Set the user role to super_admin

    // 2. Create a regular user
    const regularUser = await userStore.getOrCreateByEmail('user@test.com')
    regularUserId = regularUser.id

    // Seed role in DB if available
    const pool = await getPool()
    if (pool) {
      // Clean roles/user_roles to prevent duplicates
      await pool.query('DELETE FROM user_roles').catch(() => {})
      await pool.query('DELETE FROM roles').catch(() => {})
      await pool.query('DELETE FROM permissions').catch(() => {})

      // Seed
      await pool.query(`INSERT INTO roles (name, description) VALUES ('super_admin', 'Super admin') ON CONFLICT (name) DO NOTHING`)
      await pool.query(`INSERT INTO roles (name, description) VALUES ('support', 'Support role') ON CONFLICT (name) DO NOTHING`)
      const { rows: roleRows } = await pool.query(`SELECT id FROM roles WHERE name = 'super_admin'`)
      if (roleRows.length > 0) {
        await pool.query(`INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [superUserId, roleRows[0].id])
      }
    }

    const testToken = `super-test-token-${Date.now()}`
    const session = await sessionStore.create('superadmin@test.com', testToken)
    authToken = session.token

    app = express()
    app.use(express.json())
    app.use('/api/admin', createAdminRolesRouter())
    app.use(errorHandler)
  })

  it('should list roles with their permissions for super_admin', async () => {
    const res = await request(app)
      .get('/api/admin/roles')
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200)

    expect(res.body.success).toBe(true)
    expect(Array.isArray(res.body.roles)).toBe(true)
  })

  it('should grant and revoke roles for a user', async () => {
    const pool = await getPool()
    let supportRoleId = 'some-uuid'

    if (pool) {
      const { rows } = await pool.query(`SELECT id FROM roles WHERE name = 'support'`)
      if (rows.length > 0) {
        supportRoleId = rows[0].id
      }
    }

    // 1. Grant support role to regular user
    const grantRes = await request(app)
      .post(`/api/admin/users/${regularUserId}/roles`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ roleId: supportRoleId })
      .expect(200)

    expect(grantRes.body.success).toBe(true)

    // 2. Revoke support role
    const revokeRes = await request(app)
      .delete(`/api/admin/users/${regularUserId}/roles/${supportRoleId}`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200)

    expect(revokeRes.body.success).toBe(true)
  })

  it('should block non-super_admin from managing roles', async () => {
    // Create non-superadmin session
    const regularToken = `regular-token-${Date.now()}`
    const session = await sessionStore.create('user@test.com', regularToken)

    await request(app)
      .get('/api/admin/roles')
      .set('Authorization', `Bearer ${session.token}`)
      .expect(403)
  })
})
