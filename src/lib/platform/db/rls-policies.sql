-- =============================================================================
-- AI CFO Agent - Row Level Security policies (Step 3.9)
-- =============================================================================
--
-- Applied MANUALLY via the Supabase SQL Editor (see SETUP.md sections 3 and 6).
-- This file is NEVER run by Drizzle and is NOT part of the `pnpm db:migrate`
-- flow. Keeping it a reviewed manual step forces a human to confirm the security
-- posture on every change.
--
-- Re-runnable / idempotent: the isolation functions use CREATE OR REPLACE and
-- every policy is preceded by DROP POLICY IF EXISTS, so the whole file is safe
-- to paste and run again after any edit.
--
-- Defense-in-depth: every org-scoped query in the application layer ALSO filters
-- by org_id (sourced from getRequestContext()). RLS is the second line so a
-- forgotten or misconfigured application-layer filter cannot leak one
-- organization's financial data to another.
--
-- Every policy targets the `authenticated` role. Onboarding and other privileged
-- writes run as `service_role`, which bypasses RLS.
-- =============================================================================


-- =============================================================================
-- 1. Isolation functions
-- =============================================================================
--
-- Both functions are SECURITY DEFINER by necessity, not cosmetics. They read
-- organization_members (and firm_clients), which are themselves RLS-protected.
-- A SECURITY INVOKER function called from a policy on those same tables would
-- re-enter the policy and Postgres would abort with "infinite recursion detected
-- in policy". Running as the definer bypasses RLS inside the function body only,
-- breaking the loop while the policies still gate every row the user touches.
-- `SET search_path = public` pins name resolution so the functions cannot be
-- hijacked through a caller-controlled search path. See SETUP.md section 6.

-- Org IDs the current user may READ: their own orgs plus any accepted
-- firm-portal client orgs reachable through firm_clients.
CREATE OR REPLACE FUNCTION public.get_accessible_org_ids()
RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT org_id FROM organization_members WHERE user_id = auth.uid()
  UNION
  SELECT fc.client_org_id FROM firm_clients fc
  JOIN organization_members om ON om.org_id = fc.firm_org_id
  WHERE om.user_id = auth.uid() AND fc.accepted_at IS NOT NULL;
$$;

-- Org IDs the current user may WRITE to: their own orgs only. Firm users can
-- read client data but never mutate it.
CREATE OR REPLACE FUNCTION public.get_writable_org_ids()
RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT org_id FROM organization_members WHERE user_id = auth.uid();
$$;

GRANT EXECUTE ON FUNCTION public.get_accessible_org_ids() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_writable_org_ids() TO authenticated;


-- =============================================================================
-- 2. organizations (table 1) - keyed on `id`, not `org_id`
-- =============================================================================
--
-- No INSERT or DELETE policy for the authenticated role: organizations are
-- created and removed by the onboarding flow running as service_role.

ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "organizations_select" ON organizations;
CREATE POLICY "organizations_select" ON organizations
  FOR SELECT TO authenticated
  USING (id IN (SELECT get_accessible_org_ids()));

DROP POLICY IF EXISTS "organizations_update" ON organizations;
CREATE POLICY "organizations_update" ON organizations
  FOR UPDATE TO authenticated
  USING (id IN (SELECT get_writable_org_ids()))
  WITH CHECK (id IN (SELECT get_writable_org_ids()));


-- =============================================================================
-- 3. organization_members (table 2) - role-gated membership management
-- =============================================================================
--
-- Anyone in an accessible org may read the roster. Only an owner or admin of a
-- writable org may add or edit members. A user may always remove themselves;
-- owners/admins may remove anyone in their org.

ALTER TABLE organization_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "organization_members_select" ON organization_members;
CREATE POLICY "organization_members_select" ON organization_members
  FOR SELECT TO authenticated
  USING (org_id IN (SELECT get_accessible_org_ids()));

DROP POLICY IF EXISTS "organization_members_insert" ON organization_members;
CREATE POLICY "organization_members_insert" ON organization_members
  FOR INSERT TO authenticated
  WITH CHECK (
    org_id IN (
      SELECT om2.org_id FROM organization_members om2
      WHERE om2.user_id = auth.uid() AND om2.role IN ('owner', 'admin')
    )
  );

DROP POLICY IF EXISTS "organization_members_update" ON organization_members;
CREATE POLICY "organization_members_update" ON organization_members
  FOR UPDATE TO authenticated
  USING (
    org_id IN (
      SELECT om2.org_id FROM organization_members om2
      WHERE om2.user_id = auth.uid() AND om2.role IN ('owner', 'admin')
    )
  )
  WITH CHECK (
    org_id IN (
      SELECT om2.org_id FROM organization_members om2
      WHERE om2.user_id = auth.uid() AND om2.role IN ('owner', 'admin')
    )
  );

DROP POLICY IF EXISTS "organization_members_delete" ON organization_members;
CREATE POLICY "organization_members_delete" ON organization_members
  FOR DELETE TO authenticated
  USING (
    user_id = auth.uid()
    OR org_id IN (
      SELECT om2.org_id FROM organization_members om2
      WHERE om2.user_id = auth.uid() AND om2.role IN ('owner', 'admin')
    )
  );


-- =============================================================================
-- 4. Standard org-scoped tables (tables 3-19)
-- =============================================================================
--
-- Identical four-policy shape for every table below, keyed on the `org_id`
-- column:
--   SELECT  USING       org_id IN (SELECT get_accessible_org_ids())
--   INSERT  WITH CHECK  org_id IN (SELECT get_writable_org_ids())
--   UPDATE  USING+CHECK  org_id IN (SELECT get_writable_org_ids())
--   DELETE  USING       org_id IN (SELECT get_writable_org_ids())
--
-- Read is granted to own + firm-client orgs; write is restricted to own orgs.

-- ---------------------------------------------------------------------------
-- connections (table 3)
-- ---------------------------------------------------------------------------
ALTER TABLE connections ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "connections_select" ON connections;
CREATE POLICY "connections_select" ON connections
  FOR SELECT TO authenticated
  USING (org_id IN (SELECT get_accessible_org_ids()));

DROP POLICY IF EXISTS "connections_insert" ON connections;
CREATE POLICY "connections_insert" ON connections
  FOR INSERT TO authenticated
  WITH CHECK (org_id IN (SELECT get_writable_org_ids()));

DROP POLICY IF EXISTS "connections_update" ON connections;
CREATE POLICY "connections_update" ON connections
  FOR UPDATE TO authenticated
  USING (org_id IN (SELECT get_writable_org_ids()))
  WITH CHECK (org_id IN (SELECT get_writable_org_ids()));

DROP POLICY IF EXISTS "connections_delete" ON connections;
CREATE POLICY "connections_delete" ON connections
  FOR DELETE TO authenticated
  USING (org_id IN (SELECT get_writable_org_ids()));

-- ---------------------------------------------------------------------------
-- sync_jobs (table 4)
-- ---------------------------------------------------------------------------
ALTER TABLE sync_jobs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sync_jobs_select" ON sync_jobs;
CREATE POLICY "sync_jobs_select" ON sync_jobs
  FOR SELECT TO authenticated
  USING (org_id IN (SELECT get_accessible_org_ids()));

DROP POLICY IF EXISTS "sync_jobs_insert" ON sync_jobs;
CREATE POLICY "sync_jobs_insert" ON sync_jobs
  FOR INSERT TO authenticated
  WITH CHECK (org_id IN (SELECT get_writable_org_ids()));

DROP POLICY IF EXISTS "sync_jobs_update" ON sync_jobs;
CREATE POLICY "sync_jobs_update" ON sync_jobs
  FOR UPDATE TO authenticated
  USING (org_id IN (SELECT get_writable_org_ids()))
  WITH CHECK (org_id IN (SELECT get_writable_org_ids()));

DROP POLICY IF EXISTS "sync_jobs_delete" ON sync_jobs;
CREATE POLICY "sync_jobs_delete" ON sync_jobs
  FOR DELETE TO authenticated
  USING (org_id IN (SELECT get_writable_org_ids()));

-- ---------------------------------------------------------------------------
-- data_quality_log (table 5)
-- ---------------------------------------------------------------------------
ALTER TABLE data_quality_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "data_quality_log_select" ON data_quality_log;
CREATE POLICY "data_quality_log_select" ON data_quality_log
  FOR SELECT TO authenticated
  USING (org_id IN (SELECT get_accessible_org_ids()));

DROP POLICY IF EXISTS "data_quality_log_insert" ON data_quality_log;
CREATE POLICY "data_quality_log_insert" ON data_quality_log
  FOR INSERT TO authenticated
  WITH CHECK (org_id IN (SELECT get_writable_org_ids()));

DROP POLICY IF EXISTS "data_quality_log_update" ON data_quality_log;
CREATE POLICY "data_quality_log_update" ON data_quality_log
  FOR UPDATE TO authenticated
  USING (org_id IN (SELECT get_writable_org_ids()))
  WITH CHECK (org_id IN (SELECT get_writable_org_ids()));

DROP POLICY IF EXISTS "data_quality_log_delete" ON data_quality_log;
CREATE POLICY "data_quality_log_delete" ON data_quality_log
  FOR DELETE TO authenticated
  USING (org_id IN (SELECT get_writable_org_ids()));

-- ---------------------------------------------------------------------------
-- accounts (table 6)
-- ---------------------------------------------------------------------------
ALTER TABLE accounts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "accounts_select" ON accounts;
CREATE POLICY "accounts_select" ON accounts
  FOR SELECT TO authenticated
  USING (org_id IN (SELECT get_accessible_org_ids()));

DROP POLICY IF EXISTS "accounts_insert" ON accounts;
CREATE POLICY "accounts_insert" ON accounts
  FOR INSERT TO authenticated
  WITH CHECK (org_id IN (SELECT get_writable_org_ids()));

DROP POLICY IF EXISTS "accounts_update" ON accounts;
CREATE POLICY "accounts_update" ON accounts
  FOR UPDATE TO authenticated
  USING (org_id IN (SELECT get_writable_org_ids()))
  WITH CHECK (org_id IN (SELECT get_writable_org_ids()));

DROP POLICY IF EXISTS "accounts_delete" ON accounts;
CREATE POLICY "accounts_delete" ON accounts
  FOR DELETE TO authenticated
  USING (org_id IN (SELECT get_writable_org_ids()));

-- ---------------------------------------------------------------------------
-- transactions (table 7)
-- ---------------------------------------------------------------------------
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "transactions_select" ON transactions;
CREATE POLICY "transactions_select" ON transactions
  FOR SELECT TO authenticated
  USING (org_id IN (SELECT get_accessible_org_ids()));

DROP POLICY IF EXISTS "transactions_insert" ON transactions;
CREATE POLICY "transactions_insert" ON transactions
  FOR INSERT TO authenticated
  WITH CHECK (org_id IN (SELECT get_writable_org_ids()));

DROP POLICY IF EXISTS "transactions_update" ON transactions;
CREATE POLICY "transactions_update" ON transactions
  FOR UPDATE TO authenticated
  USING (org_id IN (SELECT get_writable_org_ids()))
  WITH CHECK (org_id IN (SELECT get_writable_org_ids()));

DROP POLICY IF EXISTS "transactions_delete" ON transactions;
CREATE POLICY "transactions_delete" ON transactions
  FOR DELETE TO authenticated
  USING (org_id IN (SELECT get_writable_org_ids()));

-- ---------------------------------------------------------------------------
-- financial_snapshots (table 8)
-- ---------------------------------------------------------------------------
ALTER TABLE financial_snapshots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "financial_snapshots_select" ON financial_snapshots;
CREATE POLICY "financial_snapshots_select" ON financial_snapshots
  FOR SELECT TO authenticated
  USING (org_id IN (SELECT get_accessible_org_ids()));

DROP POLICY IF EXISTS "financial_snapshots_insert" ON financial_snapshots;
CREATE POLICY "financial_snapshots_insert" ON financial_snapshots
  FOR INSERT TO authenticated
  WITH CHECK (org_id IN (SELECT get_writable_org_ids()));

DROP POLICY IF EXISTS "financial_snapshots_update" ON financial_snapshots;
CREATE POLICY "financial_snapshots_update" ON financial_snapshots
  FOR UPDATE TO authenticated
  USING (org_id IN (SELECT get_writable_org_ids()))
  WITH CHECK (org_id IN (SELECT get_writable_org_ids()));

DROP POLICY IF EXISTS "financial_snapshots_delete" ON financial_snapshots;
CREATE POLICY "financial_snapshots_delete" ON financial_snapshots
  FOR DELETE TO authenticated
  USING (org_id IN (SELECT get_writable_org_ids()));

-- ---------------------------------------------------------------------------
-- conversations (table 9)
-- ---------------------------------------------------------------------------
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "conversations_select" ON conversations;
CREATE POLICY "conversations_select" ON conversations
  FOR SELECT TO authenticated
  USING (org_id IN (SELECT get_accessible_org_ids()));

DROP POLICY IF EXISTS "conversations_insert" ON conversations;
CREATE POLICY "conversations_insert" ON conversations
  FOR INSERT TO authenticated
  WITH CHECK (org_id IN (SELECT get_writable_org_ids()));

DROP POLICY IF EXISTS "conversations_update" ON conversations;
CREATE POLICY "conversations_update" ON conversations
  FOR UPDATE TO authenticated
  USING (org_id IN (SELECT get_writable_org_ids()))
  WITH CHECK (org_id IN (SELECT get_writable_org_ids()));

DROP POLICY IF EXISTS "conversations_delete" ON conversations;
CREATE POLICY "conversations_delete" ON conversations
  FOR DELETE TO authenticated
  USING (org_id IN (SELECT get_writable_org_ids()));

-- ---------------------------------------------------------------------------
-- messages (table 10) - org_id denormalized from parent conversation
-- ---------------------------------------------------------------------------
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "messages_select" ON messages;
CREATE POLICY "messages_select" ON messages
  FOR SELECT TO authenticated
  USING (org_id IN (SELECT get_accessible_org_ids()));

DROP POLICY IF EXISTS "messages_insert" ON messages;
CREATE POLICY "messages_insert" ON messages
  FOR INSERT TO authenticated
  WITH CHECK (org_id IN (SELECT get_writable_org_ids()));

DROP POLICY IF EXISTS "messages_update" ON messages;
CREATE POLICY "messages_update" ON messages
  FOR UPDATE TO authenticated
  USING (org_id IN (SELECT get_writable_org_ids()))
  WITH CHECK (org_id IN (SELECT get_writable_org_ids()));

DROP POLICY IF EXISTS "messages_delete" ON messages;
CREATE POLICY "messages_delete" ON messages
  FOR DELETE TO authenticated
  USING (org_id IN (SELECT get_writable_org_ids()));

-- ---------------------------------------------------------------------------
-- query_log (table 11) - org_id denormalized
-- ---------------------------------------------------------------------------
ALTER TABLE query_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "query_log_select" ON query_log;
CREATE POLICY "query_log_select" ON query_log
  FOR SELECT TO authenticated
  USING (org_id IN (SELECT get_accessible_org_ids()));

DROP POLICY IF EXISTS "query_log_insert" ON query_log;
CREATE POLICY "query_log_insert" ON query_log
  FOR INSERT TO authenticated
  WITH CHECK (org_id IN (SELECT get_writable_org_ids()));

DROP POLICY IF EXISTS "query_log_update" ON query_log;
CREATE POLICY "query_log_update" ON query_log
  FOR UPDATE TO authenticated
  USING (org_id IN (SELECT get_writable_org_ids()))
  WITH CHECK (org_id IN (SELECT get_writable_org_ids()));

DROP POLICY IF EXISTS "query_log_delete" ON query_log;
CREATE POLICY "query_log_delete" ON query_log
  FOR DELETE TO authenticated
  USING (org_id IN (SELECT get_writable_org_ids()));

-- ---------------------------------------------------------------------------
-- alerts (table 12)
-- ---------------------------------------------------------------------------
ALTER TABLE alerts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "alerts_select" ON alerts;
CREATE POLICY "alerts_select" ON alerts
  FOR SELECT TO authenticated
  USING (org_id IN (SELECT get_accessible_org_ids()));

DROP POLICY IF EXISTS "alerts_insert" ON alerts;
CREATE POLICY "alerts_insert" ON alerts
  FOR INSERT TO authenticated
  WITH CHECK (org_id IN (SELECT get_writable_org_ids()));

DROP POLICY IF EXISTS "alerts_update" ON alerts;
CREATE POLICY "alerts_update" ON alerts
  FOR UPDATE TO authenticated
  USING (org_id IN (SELECT get_writable_org_ids()))
  WITH CHECK (org_id IN (SELECT get_writable_org_ids()));

DROP POLICY IF EXISTS "alerts_delete" ON alerts;
CREATE POLICY "alerts_delete" ON alerts
  FOR DELETE TO authenticated
  USING (org_id IN (SELECT get_writable_org_ids()));

-- ---------------------------------------------------------------------------
-- alert_configs (table 13)
-- ---------------------------------------------------------------------------
ALTER TABLE alert_configs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "alert_configs_select" ON alert_configs;
CREATE POLICY "alert_configs_select" ON alert_configs
  FOR SELECT TO authenticated
  USING (org_id IN (SELECT get_accessible_org_ids()));

DROP POLICY IF EXISTS "alert_configs_insert" ON alert_configs;
CREATE POLICY "alert_configs_insert" ON alert_configs
  FOR INSERT TO authenticated
  WITH CHECK (org_id IN (SELECT get_writable_org_ids()));

DROP POLICY IF EXISTS "alert_configs_update" ON alert_configs;
CREATE POLICY "alert_configs_update" ON alert_configs
  FOR UPDATE TO authenticated
  USING (org_id IN (SELECT get_writable_org_ids()))
  WITH CHECK (org_id IN (SELECT get_writable_org_ids()));

DROP POLICY IF EXISTS "alert_configs_delete" ON alert_configs;
CREATE POLICY "alert_configs_delete" ON alert_configs
  FOR DELETE TO authenticated
  USING (org_id IN (SELECT get_writable_org_ids()));

-- ---------------------------------------------------------------------------
-- reports (table 14)
-- ---------------------------------------------------------------------------
ALTER TABLE reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "reports_select" ON reports;
CREATE POLICY "reports_select" ON reports
  FOR SELECT TO authenticated
  USING (org_id IN (SELECT get_accessible_org_ids()));

DROP POLICY IF EXISTS "reports_insert" ON reports;
CREATE POLICY "reports_insert" ON reports
  FOR INSERT TO authenticated
  WITH CHECK (org_id IN (SELECT get_writable_org_ids()));

DROP POLICY IF EXISTS "reports_update" ON reports;
CREATE POLICY "reports_update" ON reports
  FOR UPDATE TO authenticated
  USING (org_id IN (SELECT get_writable_org_ids()))
  WITH CHECK (org_id IN (SELECT get_writable_org_ids()));

DROP POLICY IF EXISTS "reports_delete" ON reports;
CREATE POLICY "reports_delete" ON reports
  FOR DELETE TO authenticated
  USING (org_id IN (SELECT get_writable_org_ids()));

-- ---------------------------------------------------------------------------
-- subscriptions (table 15)
-- ---------------------------------------------------------------------------
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "subscriptions_select" ON subscriptions;
CREATE POLICY "subscriptions_select" ON subscriptions
  FOR SELECT TO authenticated
  USING (org_id IN (SELECT get_accessible_org_ids()));

DROP POLICY IF EXISTS "subscriptions_insert" ON subscriptions;
CREATE POLICY "subscriptions_insert" ON subscriptions
  FOR INSERT TO authenticated
  WITH CHECK (org_id IN (SELECT get_writable_org_ids()));

DROP POLICY IF EXISTS "subscriptions_update" ON subscriptions;
CREATE POLICY "subscriptions_update" ON subscriptions
  FOR UPDATE TO authenticated
  USING (org_id IN (SELECT get_writable_org_ids()))
  WITH CHECK (org_id IN (SELECT get_writable_org_ids()));

DROP POLICY IF EXISTS "subscriptions_delete" ON subscriptions;
CREATE POLICY "subscriptions_delete" ON subscriptions
  FOR DELETE TO authenticated
  USING (org_id IN (SELECT get_writable_org_ids()));

-- ---------------------------------------------------------------------------
-- intelligence_runs (table 16)
-- ---------------------------------------------------------------------------
ALTER TABLE intelligence_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "intelligence_runs_select" ON intelligence_runs;
CREATE POLICY "intelligence_runs_select" ON intelligence_runs
  FOR SELECT TO authenticated
  USING (org_id IN (SELECT get_accessible_org_ids()));

DROP POLICY IF EXISTS "intelligence_runs_insert" ON intelligence_runs;
CREATE POLICY "intelligence_runs_insert" ON intelligence_runs
  FOR INSERT TO authenticated
  WITH CHECK (org_id IN (SELECT get_writable_org_ids()));

DROP POLICY IF EXISTS "intelligence_runs_update" ON intelligence_runs;
CREATE POLICY "intelligence_runs_update" ON intelligence_runs
  FOR UPDATE TO authenticated
  USING (org_id IN (SELECT get_writable_org_ids()))
  WITH CHECK (org_id IN (SELECT get_writable_org_ids()));

DROP POLICY IF EXISTS "intelligence_runs_delete" ON intelligence_runs;
CREATE POLICY "intelligence_runs_delete" ON intelligence_runs
  FOR DELETE TO authenticated
  USING (org_id IN (SELECT get_writable_org_ids()));

-- ---------------------------------------------------------------------------
-- findings (table 17)
-- ---------------------------------------------------------------------------
ALTER TABLE findings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "findings_select" ON findings;
CREATE POLICY "findings_select" ON findings
  FOR SELECT TO authenticated
  USING (org_id IN (SELECT get_accessible_org_ids()));

DROP POLICY IF EXISTS "findings_insert" ON findings;
CREATE POLICY "findings_insert" ON findings
  FOR INSERT TO authenticated
  WITH CHECK (org_id IN (SELECT get_writable_org_ids()));

DROP POLICY IF EXISTS "findings_update" ON findings;
CREATE POLICY "findings_update" ON findings
  FOR UPDATE TO authenticated
  USING (org_id IN (SELECT get_writable_org_ids()))
  WITH CHECK (org_id IN (SELECT get_writable_org_ids()));

DROP POLICY IF EXISTS "findings_delete" ON findings;
CREATE POLICY "findings_delete" ON findings
  FOR DELETE TO authenticated
  USING (org_id IN (SELECT get_writable_org_ids()));

-- ---------------------------------------------------------------------------
-- action_drafts (table 18)
-- ---------------------------------------------------------------------------
ALTER TABLE action_drafts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "action_drafts_select" ON action_drafts;
CREATE POLICY "action_drafts_select" ON action_drafts
  FOR SELECT TO authenticated
  USING (org_id IN (SELECT get_accessible_org_ids()));

DROP POLICY IF EXISTS "action_drafts_insert" ON action_drafts;
CREATE POLICY "action_drafts_insert" ON action_drafts
  FOR INSERT TO authenticated
  WITH CHECK (org_id IN (SELECT get_writable_org_ids()));

DROP POLICY IF EXISTS "action_drafts_update" ON action_drafts;
CREATE POLICY "action_drafts_update" ON action_drafts
  FOR UPDATE TO authenticated
  USING (org_id IN (SELECT get_writable_org_ids()))
  WITH CHECK (org_id IN (SELECT get_writable_org_ids()));

DROP POLICY IF EXISTS "action_drafts_delete" ON action_drafts;
CREATE POLICY "action_drafts_delete" ON action_drafts
  FOR DELETE TO authenticated
  USING (org_id IN (SELECT get_writable_org_ids()));

-- ---------------------------------------------------------------------------
-- cash_flow_projections (table 19)
-- ---------------------------------------------------------------------------
ALTER TABLE cash_flow_projections ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "cash_flow_projections_select" ON cash_flow_projections;
CREATE POLICY "cash_flow_projections_select" ON cash_flow_projections
  FOR SELECT TO authenticated
  USING (org_id IN (SELECT get_accessible_org_ids()));

DROP POLICY IF EXISTS "cash_flow_projections_insert" ON cash_flow_projections;
CREATE POLICY "cash_flow_projections_insert" ON cash_flow_projections
  FOR INSERT TO authenticated
  WITH CHECK (org_id IN (SELECT get_writable_org_ids()));

DROP POLICY IF EXISTS "cash_flow_projections_update" ON cash_flow_projections;
CREATE POLICY "cash_flow_projections_update" ON cash_flow_projections
  FOR UPDATE TO authenticated
  USING (org_id IN (SELECT get_writable_org_ids()))
  WITH CHECK (org_id IN (SELECT get_writable_org_ids()));

DROP POLICY IF EXISTS "cash_flow_projections_delete" ON cash_flow_projections;
CREATE POLICY "cash_flow_projections_delete" ON cash_flow_projections
  FOR DELETE TO authenticated
  USING (org_id IN (SELECT get_writable_org_ids()));


-- =============================================================================
-- 5. consent_log (table 20) - APPEND-ONLY
-- =============================================================================
--
-- consent_log is a compliance audit trail. It is append-only by policy: a
-- changed consent produces a NEW row so the full history is preserved for legal
-- defensibility. Only SELECT and INSERT policies are defined below.
--
-- There is deliberately NO update policy and NO delete policy. With RLS enabled
-- and no permissive policy for those commands, every UPDATE and DELETE attempt
-- by the authenticated role is denied by default. Immutability is therefore
-- enforced at the RLS layer, matching the schema.ts contract for this table. Do
-- not add an update or delete policy here.

ALTER TABLE consent_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "consent_log_select" ON consent_log;
CREATE POLICY "consent_log_select" ON consent_log
  FOR SELECT TO authenticated
  USING (org_id IN (SELECT get_accessible_org_ids()));

DROP POLICY IF EXISTS "consent_log_insert" ON consent_log;
CREATE POLICY "consent_log_insert" ON consent_log
  FOR INSERT TO authenticated
  WITH CHECK (org_id IN (SELECT get_writable_org_ids()));


-- =============================================================================
-- 6. firm_clients (table 21) - two org ID columns (firm_org_id, client_org_id)
-- =============================================================================
--
-- Read is granted if EITHER the firm org or the client org is accessible to the
-- user. Only an owner/admin of the FIRM org may create, edit, or remove a link;
-- the client side cannot mutate the relationship.

ALTER TABLE firm_clients ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "firm_clients_select" ON firm_clients;
CREATE POLICY "firm_clients_select" ON firm_clients
  FOR SELECT TO authenticated
  USING (
    firm_org_id IN (SELECT get_accessible_org_ids())
    OR client_org_id IN (SELECT get_accessible_org_ids())
  );

DROP POLICY IF EXISTS "firm_clients_insert" ON firm_clients;
CREATE POLICY "firm_clients_insert" ON firm_clients
  FOR INSERT TO authenticated
  WITH CHECK (
    firm_org_id IN (
      SELECT om2.org_id FROM organization_members om2
      WHERE om2.user_id = auth.uid() AND om2.role IN ('owner', 'admin')
    )
  );

DROP POLICY IF EXISTS "firm_clients_update" ON firm_clients;
CREATE POLICY "firm_clients_update" ON firm_clients
  FOR UPDATE TO authenticated
  USING (
    firm_org_id IN (
      SELECT om2.org_id FROM organization_members om2
      WHERE om2.user_id = auth.uid() AND om2.role IN ('owner', 'admin')
    )
  )
  WITH CHECK (
    firm_org_id IN (
      SELECT om2.org_id FROM organization_members om2
      WHERE om2.user_id = auth.uid() AND om2.role IN ('owner', 'admin')
    )
  );

DROP POLICY IF EXISTS "firm_clients_delete" ON firm_clients;
CREATE POLICY "firm_clients_delete" ON firm_clients
  FOR DELETE TO authenticated
  USING (
    firm_org_id IN (
      SELECT om2.org_id FROM organization_members om2
      WHERE om2.user_id = auth.uid() AND om2.role IN ('owner', 'admin')
    )
  );

-- =============================================================================
-- End of RLS policies. 21 tables secured, 80 policies defined.
-- =============================================================================
