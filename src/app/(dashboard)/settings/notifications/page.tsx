"use client";

/**
 * Settings > Notification Preferences page.
 *
 * Loads alert configs from GET /api/alert-configs and lets the user toggle
 * each alert type on/off and opt into email delivery per type. Changes are
 * PATCHed to /api/alert-configs/:alertType immediately (optimistic update
 * with revert on server error).
 *
 * The "Opt out of all email" toggle is a client-side convenience — it sends
 * PATCH { emailNotifications: false } (or true) to all four alert types and
 * is NOT a separate database field.
 */

import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Domain types — local to this page (not in src/types/api.ts)
// ---------------------------------------------------------------------------

type AlertType =
  | "cash_flow_risk"
  | "anomaly"
  | "collections_opportunity"
  | "duplicate_subscription";

type AlertConfigItem = {
  alertType: AlertType;
  isEnabled: boolean;
  emailNotifications: boolean;
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ALERT_TYPES = [
  "cash_flow_risk",
  "anomaly",
  "collections_opportunity",
  "duplicate_subscription",
] as const satisfies readonly AlertType[];

const ALERT_DISPLAY_NAMES: Record<AlertType, string> = {
  cash_flow_risk: "Cash Flow Risk",
  anomaly: "Expense Spike",
  collections_opportunity: "Collections Opportunity",
  duplicate_subscription: "Duplicate Subscription",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function applyConfigUpdate(
  prev: AlertConfigItem[] | null,
  alertType: AlertType,
  field: "isEnabled" | "emailNotifications",
  value: boolean,
): AlertConfigItem[] | null {
  if (prev === null) return prev;
  return prev.map((c): AlertConfigItem => {
    if (c.alertType !== alertType) return c;
    if (field === "isEnabled") return { ...c, isEnabled: value };
    return { ...c, emailNotifications: value };
  });
}

// ---------------------------------------------------------------------------
// ToggleSwitch — reusable within this module
// ---------------------------------------------------------------------------

type ToggleSwitchProps = {
  checked: boolean;
  onToggle: () => void;
  ariaLabel: string;
  disabled?: boolean;
};

function ToggleSwitch({
  checked,
  onToggle,
  ariaLabel,
  disabled = false,
}: ToggleSwitchProps): React.JSX.Element {
  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      type="button"
      onClick={onToggle}
      disabled={disabled}
      className={cn(
        "relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary-500)]",
        disabled && "cursor-not-allowed opacity-50",
        checked ? "bg-[var(--primary-500)]" : "bg-[var(--gray-300)]",
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow ring-0 transition duration-200",
          checked ? "translate-x-5" : "translate-x-0",
        )}
      />
    </button>
  );
}

// ---------------------------------------------------------------------------
// SkeletonRow — placeholder while configs are loading
// ---------------------------------------------------------------------------

function SkeletonRow(): React.JSX.Element {
  return (
    <div className="flex items-center justify-between gap-4 py-4" aria-hidden="true">
      <div className="h-4 w-44 animate-pulse rounded bg-[var(--gray-200)]" />
      <div className="flex items-center gap-6">
        <div className="h-6 w-11 animate-pulse rounded-full bg-[var(--gray-200)]" />
        <div className="h-6 w-11 animate-pulse rounded-full bg-[var(--gray-200)]" />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// AlertRow — one alert type in the config list
// ---------------------------------------------------------------------------

type AlertRowProps = {
  config: AlertConfigItem;
  onToggleEnabled: () => void;
  onToggleEmail: () => void;
};

function AlertRow({ config, onToggleEnabled, onToggleEmail }: AlertRowProps): React.JSX.Element {
  const displayName = ALERT_DISPLAY_NAMES[config.alertType] ?? config.alertType;

  return (
    <div className="flex items-center justify-between gap-4 py-4">
      <p className="min-w-0 text-sm font-medium text-[var(--text-primary)]">{displayName}</p>
      <div className="flex shrink-0 items-center gap-6">
        {/* Email toggle — only rendered when the alert type is enabled */}
        {config.isEnabled && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-[var(--text-secondary)]">Email</span>
            <ToggleSwitch
              checked={config.emailNotifications}
              onToggle={onToggleEmail}
              ariaLabel={`Email notifications for ${displayName}`}
            />
          </div>
        )}
        {/* Enabled toggle */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-[var(--text-secondary)]">Enabled</span>
          <ToggleSwitch
            checked={config.isEnabled}
            onToggle={onToggleEnabled}
            ariaLabel={`Enable ${displayName} alerts`}
          />
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function NotificationsPage(): React.JSX.Element {
  const [configs, setConfigs] = useState<AlertConfigItem[] | null>(null);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    let cancelled = false;

    fetch("/api/alert-configs")
      .then(async (res) => {
        if (res.status === 401) {
          window.location.href = "/login";
          return;
        }
        if (!res.ok) {
          if (!cancelled) setLoadError(true);
          return;
        }
        const json = (await res.json()) as { data: AlertConfigItem[] };
        if (!cancelled) setConfigs(json.data);
      })
      .catch(() => {
        if (!cancelled) setLoadError(true);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  async function handleToggle(
    alertType: AlertType,
    field: "isEnabled" | "emailNotifications",
    newValue: boolean,
  ): Promise<void> {
    // Optimistic update
    setConfigs((prev) => applyConfigUpdate(prev, alertType, field, newValue));

    try {
      const res = await fetch(`/api/alert-configs/${alertType}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [field]: newValue }),
      });
      if (!res.ok) {
        // Revert on server error
        setConfigs((prev) => applyConfigUpdate(prev, alertType, field, !newValue));
      }
    } catch {
      // Revert on network error
      setConfigs((prev) => applyConfigUpdate(prev, alertType, field, !newValue));
    }
  }

  async function handleOptOutAllEmail(optOut: boolean): Promise<void> {
    const emailValue = !optOut; // optOut=true → emailNotifications=false

    // Optimistic update all rows
    setConfigs((prev) => {
      if (prev === null) return prev;
      return prev.map((c): AlertConfigItem => ({ ...c, emailNotifications: emailValue }));
    });

    const results = await Promise.allSettled(
      ALERT_TYPES.map((alertType) =>
        fetch(`/api/alert-configs/${alertType}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ emailNotifications: emailValue }),
        }),
      ),
    );

    const anyFailed = results.some(
      (r) => r.status === "rejected" || (r.status === "fulfilled" && !r.value.ok),
    );

    if (anyFailed) {
      // Re-fetch to restore consistent server state
      try {
        const res = await fetch("/api/alert-configs");
        if (res.ok) {
          const json = (await res.json()) as { data: AlertConfigItem[] };
          setConfigs(json.data);
        }
      } catch {
        // Best-effort recovery only — state may be stale until next refresh
      }
    }
  }

  // The opt-out toggle is checked when every config has emailNotifications=false
  const allEmailOff =
    configs !== null && configs.length > 0 && configs.every((c) => !c.emailNotifications);

  return (
    <div className="flex flex-col gap-8">
      {/* Page header */}
      <div className="border-b border-[var(--border-default)] pb-6">
        <h1 className="text-2xl font-semibold text-[var(--text-primary)]">
          Notification Preferences
        </h1>
        <p className="mt-1 text-sm text-[var(--text-secondary)]">
          Choose which alerts you receive and how they are delivered.
        </p>
      </div>

      {/* Error state */}
      {loadError && (
        <div
          role="alert"
          className="rounded-md border border-[var(--border-default)] bg-[var(--surface-card)] px-5 py-4 text-sm text-[var(--text-secondary)]"
        >
          Failed to load notification settings.
        </div>
      )}

      {/* Main content — only rendered when not in error state */}
      {!loadError && (
        <>
          {/* Alert type rows */}
          <section aria-labelledby="alert-types-heading">
            <h2
              id="alert-types-heading"
              className="text-base font-semibold text-[var(--text-primary)]"
            >
              Alert Types
            </h2>
            <div className="mt-3 divide-y divide-[var(--border-default)] rounded-md border border-[var(--border-default)] bg-[var(--surface-card)] px-4">
              {configs === null
                ? ALERT_TYPES.map((alertType) => <SkeletonRow key={alertType} />)
                : configs.map((config) => (
                    <AlertRow
                      key={config.alertType}
                      config={config}
                      onToggleEnabled={() => {
                        void handleToggle(config.alertType, "isEnabled", !config.isEnabled);
                      }}
                      onToggleEmail={() => {
                        void handleToggle(
                          config.alertType,
                          "emailNotifications",
                          !config.emailNotifications,
                        );
                      }}
                    />
                  ))}
            </div>
          </section>

          {/* Email delivery info — non-configurable, informational only */}
          <section
            aria-labelledby="email-delivery-heading"
            className="rounded-md border border-[var(--border-default)] bg-[var(--surface-card)] p-5"
          >
            <h2
              id="email-delivery-heading"
              className="text-sm font-semibold text-[var(--text-primary)]"
            >
              Email Delivery
            </h2>
            <p className="mt-1 text-sm leading-relaxed text-[var(--text-secondary)]">
              Email alerts are sent for critical and high severity findings only. Low and medium
              findings are in-app only.
            </p>
          </section>

          {/* Opt out of all email — convenience toggle */}
          <section
            aria-labelledby="opt-out-heading"
            className="rounded-md border border-[var(--border-default)] bg-[var(--surface-card)] p-5"
          >
            <div className="flex items-center justify-between gap-4">
              <div>
                <h2
                  id="opt-out-heading"
                  className="text-sm font-semibold text-[var(--text-primary)]"
                >
                  Opt out of all email notifications
                </h2>
                <p className="mt-0.5 text-sm text-[var(--text-secondary)]">
                  Disable all email delivery. In-app findings are unaffected.
                </p>
              </div>
              <ToggleSwitch
                checked={allEmailOff}
                onToggle={() => {
                  void handleOptOutAllEmail(!allEmailOff);
                }}
                ariaLabel="Opt out of all email notifications"
                disabled={configs === null}
              />
            </div>
          </section>
        </>
      )}
    </div>
  );
}
