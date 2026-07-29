import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { ShieldCheck } from "lucide-react";

import { env } from "@/lib/env";
import { formatDate } from "@/lib/format";
import type { ConnectionSummary } from "@/types/api";

// --------------------------------------------------------------------------
// Sync-status badge config — documented mapping from API syncStatus values
// to display labels and exact hex colors (CLAUDE.md exception: mapping table).
//
//   success:      gain-100 bg (#DCFCE7), gain-700 text (#166534)
//   in_progress:  warning-100 bg (#FEF3C7), warning-700 text (#92400E)
//   failed:       loss-100 bg (#FFE4E4), loss-700 text (#A21520)
//   auth_expired: loss-100 bg (#FFE4E4), loss-700 text (#A21520)
// --------------------------------------------------------------------------

type StatusBadgeConfig = { label: string; bg: string; text: string };

const SYNC_STATUS_CONFIG: Record<string, StatusBadgeConfig> = {
  success: { label: "Connected", bg: "#DCFCE7", text: "#166534" },
  in_progress: { label: "Syncing…", bg: "#FEF3C7", text: "#92400E" },
  failed: { label: "Sync failed", bg: "#FFE4E4", text: "#A21520" },
  auth_expired: { label: "Reconnect required", bg: "#FFE4E4", text: "#A21520" },
};

const DEFAULT_STATUS_CONFIG: StatusBadgeConfig = {
  label: "Not synced",
  bg: "#F1F5F9",
  text: "#334155",
};

// --------------------------------------------------------------------------
// Provider display config — documented mapping from provider key to display
// information. Brand colors documented here as the mapping table:
//   quickbooks: QuickBooks brand green (#2CA01C)
//   xero:       Xero brand blue (#1AB4D7)
// --------------------------------------------------------------------------

const PROVIDER_DISPLAY_CONFIG = {
  quickbooks: {
    label: "QuickBooks",
    initials: "QB",
    /** QuickBooks brand green — bg-[#2CA01C] */
    logoBgClass: "bg-[#2CA01C]",
    initiateUrl: "/api/auth/quickbooks/initiate",
  },
  xero: {
    label: "Xero",
    initials: "Xero",
    /** Xero brand blue — bg-[#1AB4D7] */
    logoBgClass: "bg-[#1AB4D7]",
    initiateUrl: "/api/auth/xero/initiate",
  },
} as const;

type ProviderKey = keyof typeof PROVIDER_DISPLAY_CONFIG;

// --------------------------------------------------------------------------
// ProviderCard — renders an active or inactive card for one accounting provider
// --------------------------------------------------------------------------

type ProviderCardProps = {
  providerKey: ProviderKey;
  connection: ConnectionSummary | null;
  /** Label of the other currently-connected accounting provider, or null. */
  otherConnectedLabel: string | null;
};

function ProviderCard({
  providerKey,
  connection,
  otherConnectedLabel,
}: ProviderCardProps): React.JSX.Element {
  const display = PROVIDER_DISPLAY_CONFIG[providerKey];

  // Active / connected state
  if (connection !== null) {
    const statusConfig: StatusBadgeConfig =
      connection.syncStatus !== null
        ? (SYNC_STATUS_CONFIG[connection.syncStatus] ?? DEFAULT_STATUS_CONFIG)
        : DEFAULT_STATUS_CONFIG;

    return (
      <div className="rounded-md border border-[var(--border-default)] bg-[var(--surface-card)] p-6 shadow-sm">
        {/* Card header: logo, name, company name, status badge */}
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            {/* Provider logo placeholder — brand color from PROVIDER_DISPLAY_CONFIG */}
            <div
              className={`flex h-10 w-10 shrink-0 items-center justify-center rounded text-sm font-bold text-white ${display.logoBgClass}`}
              aria-hidden="true"
            >
              {display.initials}
            </div>
            <div>
              <h2 className="text-base font-semibold text-[var(--text-primary)]">
                {display.label}
              </h2>
              {connection.providerCompanyName !== null && (
                <p className="text-sm text-[var(--text-secondary)]">
                  {connection.providerCompanyName}
                </p>
              )}
            </div>
          </div>
          {/* Status badge — hex from SYNC_STATUS_CONFIG above */}
          <span
            className="inline-flex shrink-0 items-center rounded-full px-2.5 py-0.5 text-xs font-medium"
            style={{ backgroundColor: statusConfig.bg, color: statusConfig.text }}
          >
            {statusConfig.label}
          </span>
        </div>

        {/* Connection metadata */}
        <dl className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <dt className="text-xs font-medium text-[var(--text-muted)]">Last synced</dt>
            <dd className="mt-0.5 text-sm text-[var(--text-secondary)]">
              {connection.lastSyncedAt !== null
                ? formatDate(connection.lastSyncedAt)
                : "Never synced"}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-[var(--text-muted)]">Last intelligence run</dt>
            <dd className="mt-0.5 text-sm text-[var(--text-secondary)]">
              {connection.lastIntelligenceRunAt !== null
                ? formatDate(connection.lastIntelligenceRunAt)
                : "Not yet run"}
            </dd>
          </div>
        </dl>

        {/* Disconnect action — disabled in V1 */}
        <div className="mt-5 border-t border-[var(--border-subtle)] pt-4">
          <button
            type="button"
            disabled
            title="Contact support to disconnect your integration"
            aria-label="Disconnect (unavailable — contact support to disconnect)"
            className="cursor-not-allowed rounded border border-[var(--border-default)] px-3 py-1.5 text-sm text-[var(--text-muted)] opacity-50"
          >
            Disconnect
          </button>
        </div>
      </div>
    );
  }

  // Inactive / not connected state
  return (
    <div className="rounded-md border border-[var(--border-default)] bg-[var(--gray-50)] p-6">
      {/* Card header: greyed logo + name */}
      <div className="flex items-center gap-3">
        <div
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded bg-[var(--gray-200)] text-sm font-bold text-[var(--text-muted)]"
          aria-hidden="true"
        >
          {display.initials}
        </div>
        <div>
          <h2 className="text-base font-semibold text-[var(--text-secondary)]">{display.label}</h2>
          <p className="text-sm text-[var(--text-muted)]">Not connected</p>
        </div>
      </div>

      {/* Connect action */}
      <div className="mt-5 border-t border-[var(--border-subtle)] pt-4">
        {otherConnectedLabel !== null ? (
          <>
            <button
              type="button"
              disabled
              aria-disabled="true"
              className="cursor-not-allowed rounded bg-[var(--gray-200)] px-3 py-1.5 text-sm text-[var(--text-muted)]"
            >
              Connect {display.label}
            </button>
            <p className="mt-2 text-xs text-[var(--text-muted)]">
              Disconnect {otherConnectedLabel} first to switch.
            </p>
          </>
        ) : (
          <a
            href={display.initiateUrl}
            className="inline-flex items-center rounded bg-[var(--primary-500)] px-3 py-1.5 text-sm font-medium text-white transition-colors duration-100 hover:bg-[var(--primary-600)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary-500)]"
          >
            Connect {display.label}
          </a>
        )}
      </div>
    </div>
  );
}

// --------------------------------------------------------------------------
// Page — Server Component (no "use client")
// --------------------------------------------------------------------------

export default async function ConnectionsPage(): Promise<React.JSX.Element> {
  const baseUrl = env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const cookie = (await headers()).get("cookie") ?? "";

  const res = await fetch(`${baseUrl}/api/connections`, {
    headers: { cookie },
    cache: "no-store",
  });

  // 401: session absent or expired — redirect to login
  if (res.status === 401) {
    redirect("/login");
  }

  // Any non-OK response other than 401 — show error state
  if (!res.ok) {
    return (
      <div className="flex flex-col gap-6">
        <div className="border-b border-[var(--border-default)] pb-6">
          <h1 className="text-2xl font-semibold text-[var(--text-primary)]">Connections</h1>
          <p className="mt-1 text-sm text-[var(--text-secondary)]">
            Manage your accounting data connections.
          </p>
        </div>
        <div
          role="alert"
          className="rounded-md border border-[var(--border-default)] bg-[var(--surface-card)] px-5 py-4 text-sm text-[var(--text-secondary)]"
        >
          Unable to load connection status. Refresh to try again.
        </div>
      </div>
    );
  }

  type ConnectionsResponse = { data: ConnectionSummary[] };
  type ConnectionsError = { error: { code: string; message: string } };

  const json = (await res.json()) as ConnectionsResponse | ConnectionsError;

  if ("error" in json) {
    return (
      <div className="flex flex-col gap-6">
        <div className="border-b border-[var(--border-default)] pb-6">
          <h1 className="text-2xl font-semibold text-[var(--text-primary)]">Connections</h1>
          <p className="mt-1 text-sm text-[var(--text-secondary)]">
            Manage your accounting data connections.
          </p>
        </div>
        <div
          role="alert"
          className="rounded-md border border-[var(--border-default)] bg-[var(--surface-card)] px-5 py-4 text-sm text-[var(--text-secondary)]"
        >
          Unable to load connection status. Refresh to try again.
        </div>
      </div>
    );
  }

  const connections = json.data;

  const qbConnection = connections.find((c) => c.provider === "quickbooks" && c.isActive) ?? null;
  const xeroConnection = connections.find((c) => c.provider === "xero" && c.isActive) ?? null;
  const hasCsvImport = connections.some((c) => c.provider === "csv");

  // Which accounting provider (if any) is blocking a switch for the other one
  const qbBlockedBy = xeroConnection !== null ? "Xero" : null;
  const xeroBlockedBy = qbConnection !== null ? "QuickBooks" : null;

  return (
    <div className="flex flex-col gap-6">
      {/* Page header */}
      <div className="border-b border-[var(--border-default)] pb-6">
        <h1 className="text-2xl font-semibold text-[var(--text-primary)]">Connections</h1>
        <p className="mt-1 text-sm text-[var(--text-secondary)]">
          Manage your accounting data connections.
        </p>
      </div>

      {/* Data sovereignty notice — FRONTEND_GUIDELINES Section 13.4 inline variant */}
      <div
        className="flex items-start gap-2 rounded border border-[var(--primary-200)] bg-[var(--primary-50)] px-3 py-2"
        role="note"
        aria-label="Data sovereignty notice"
      >
        <ShieldCheck
          size={14}
          className="mt-0.5 shrink-0 text-[var(--primary-500)]"
          aria-hidden="true"
        />
        <p className="text-[0.8125rem] leading-[1.6] text-[var(--primary-800)]">
          <strong className="font-semibold">Read-only access. Always.</strong> CFO Lens connects to
          your accounting software but never writes to it.
        </p>
      </div>

      {/* Provider cards — QuickBooks and Xero always rendered */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <ProviderCard
          providerKey="quickbooks"
          connection={qbConnection}
          otherConnectedLabel={qbBlockedBy}
        />
        <ProviderCard
          providerKey="xero"
          connection={xeroConnection}
          otherConnectedLabel={xeroBlockedBy}
        />
      </div>

      {/* CSV import note — shown when a CSV connection exists */}
      {hasCsvImport && (
        <p className="text-sm text-[var(--text-secondary)]">
          You have a CSV import. Connect QuickBooks or Xero for live monitoring.
        </p>
      )}
    </div>
  );
}
