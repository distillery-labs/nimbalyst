import React, { useEffect, useState } from 'react';
import { MaterialSymbol } from '@nimbalyst/runtime';

interface TrackerCostPanelProps {
  trackerId: string;
  /**
   * Increments whenever linked sessions change. Forces a refetch so the
   * rollup stays in sync after the user links or unlinks a session.
   */
  refreshKey?: number;
}

function formatCost(usd: number): string {
  if (usd === 0) return '$0';
  if (usd < 0.01) return '<$0.01';
  if (usd < 100) return `$${usd.toFixed(2)}`;
  return `$${Math.round(usd).toLocaleString()}`;
}

/**
 * TrackerCostPanel — surfaces the SQL view `tracker_cost_rollup` for a tracker
 * item. Sums denormalized cost / token totals across all linked sessions.
 *
 * The component is intentionally read-only and refetches on `refreshKey`
 * bumps; we don't subscribe to the underlying ai_sessions atoms because the
 * authoritative aggregate lives in the DB view (and we'd need to track every
 * linked session's atom otherwise).
 */
export function TrackerCostPanel({ trackerId, refreshKey = 0 }: TrackerCostPanelProps) {
  const [rollup, setRollup] = useState<TrackerCostRollup | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void window.electronAPI.cost.getTrackerRollup(trackerId).then((data) => {
      if (cancelled) return;
      setRollup(data);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [trackerId, refreshKey]);

  if (loading) {
    return (
      <div className="tracker-cost-panel pt-1 border-t border-nim">
        <label className="text-[11px] font-medium text-nim-muted uppercase tracking-[0.5px]">Cost</label>
        <p className="text-[11px] text-nim-faint mt-1 mb-0">Loading…</p>
      </div>
    );
  }

  if (!rollup || rollup.linkedSessionCount === 0) {
    return null;
  }

  const totalTokens =
    rollup.totalInputTokens + rollup.totalOutputTokens + rollup.totalCacheReadTokens + rollup.totalCacheCreateTokens;

  return (
    <div className="tracker-cost-panel pt-1 border-t border-nim" data-testid="tracker-cost-panel">
      <div className="flex items-center justify-between mb-1.5">
        <label className="text-[11px] font-medium text-nim-muted uppercase tracking-[0.5px]">Cost</label>
        <span className="text-[11px] text-nim-faint">
          {rollup.linkedSessionCount} session{rollup.linkedSessionCount === 1 ? '' : 's'}
        </span>
      </div>
      <div className="rounded border border-nim bg-nim-tertiary p-2 space-y-1">
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-1 text-xs text-nim-muted">
            <MaterialSymbol icon="payments" size={14} />
            Total
          </span>
          <span className="text-sm font-semibold text-nim tabular-nums">{formatCost(rollup.totalCostUsd)}</span>
        </div>
        <div className="flex items-center justify-between text-[11px]">
          <span className="text-nim-faint">Tokens</span>
          <span className="text-nim-muted tabular-nums">{totalTokens.toLocaleString()}</span>
        </div>
        {(rollup.totalInputTokens > 0 || rollup.totalOutputTokens > 0) && (
          <div className="flex flex-col gap-0.5 text-[11px] pt-1 mt-1 border-t border-nim">
            <TokenRow label="Input" tokens={rollup.totalInputTokens} />
            <TokenRow label="Output" tokens={rollup.totalOutputTokens} />
            {rollup.totalCacheReadTokens > 0 && <TokenRow label="Cache read" tokens={rollup.totalCacheReadTokens} />}
            {rollup.totalCacheCreateTokens > 0 && (
              <TokenRow label="Cache write" tokens={rollup.totalCacheCreateTokens} />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function TokenRow({ label, tokens }: { label: string; tokens: number }) {
  return (
    <div className="flex justify-between">
      <span className="text-nim-faint">{label}:</span>
      <span className="text-nim-muted tabular-nums">{tokens.toLocaleString()}</span>
    </div>
  );
}
