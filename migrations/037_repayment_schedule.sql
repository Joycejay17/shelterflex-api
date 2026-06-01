-- Repayment schedule table for deterministic installment calendars
-- Stores payment schedules with principal, interest, and status tracking

CREATE TABLE IF NOT EXISTS repayment_schedule (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    deal_id UUID NOT NULL REFERENCES tenant_deals(deal_id) ON DELETE CASCADE,
    payment_number INTEGER NOT NULL,
    due_date TIMESTAMPTZ NOT NULL,
    principal_amount_ngn BIGINT NOT NULL CHECK (principal_amount_ngn >= 0),
    interest_amount_ngn BIGINT NOT NULL CHECK (interest_amount_ngn >= 0),
    total_amount_ngn BIGINT NOT NULL CHECK (total_amount_ngn >= 0),
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'overdue', 'waived')),
    paid_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(deal_id, payment_number)
);

CREATE INDEX IF NOT EXISTS repayment_schedule_deal_id_idx ON repayment_schedule(deal_id);
CREATE INDEX IF NOT EXISTS repayment_schedule_status_idx ON repayment_schedule(status);
CREATE INDEX IF NOT EXISTS repayment_schedule_due_date_idx ON repayment_schedule(due_date);
