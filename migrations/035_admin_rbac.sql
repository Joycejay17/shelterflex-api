-- Migration 035: Admin RBAC Tables
-- Resolves issue #968

CREATE TABLE IF NOT EXISTS roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL UNIQUE,
    description TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS permissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    resource TEXT NOT NULL,
    action TEXT NOT NULL,
    UNIQUE (resource, action)
);

CREATE TABLE IF NOT EXISTS role_permissions (
    role_id UUID REFERENCES roles(id) ON DELETE CASCADE,
    permission_id UUID REFERENCES permissions(id) ON DELETE CASCADE,
    PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE IF NOT EXISTS user_roles (
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    role_id UUID REFERENCES roles(id) ON DELETE CASCADE,
    granted_by UUID,
    granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, role_id)
);

-- Seed default roles
INSERT INTO roles (name, description) VALUES
('support', 'Customer support agent role with limited access to view disputes'),
('finance', 'Financial admin role capable of viewing payouts and resolving transactions'),
('operations', 'Operations role with access to view disputes and manage platform logs'),
('super_admin', 'Implicitly has all permissions and full administrative rights')
ON CONFLICT (name) DO NOTHING;

-- Seed default permissions
INSERT INTO permissions (resource, action) VALUES
('disputes', 'view'),
('disputes', 'resolve'),
('payouts', 'trigger'),
('kyc', 'view'),
('kyc', 'verify')
ON CONFLICT (resource, action) DO NOTHING;

-- Link support role to disputes:view and kyc:view
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name = 'support' AND (
    (p.resource = 'disputes' AND p.action = 'view') OR
    (p.resource = 'kyc' AND p.action = 'view')
)
ON CONFLICT DO NOTHING;

-- Link finance role to payouts:trigger and kyc:view
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name = 'finance' AND (
    (p.resource = 'payouts' AND p.action = 'trigger') OR
    (p.resource = 'kyc' AND p.action = 'view')
)
ON CONFLICT DO NOTHING;

-- Link operations role to disputes:view and kyc:view
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name = 'operations' AND (
    (p.resource = 'disputes' AND p.action = 'view') OR
    (p.resource = 'kyc' AND p.action = 'view')
)
ON CONFLICT DO NOTHING;
