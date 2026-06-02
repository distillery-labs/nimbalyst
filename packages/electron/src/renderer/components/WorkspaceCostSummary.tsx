import React, { useEffect, useState, useId } from 'react';
import { MaterialSymbol } from '@nimbalyst/runtime';

interface WorkspaceCostSummaryProps {
  workspacePath: string;
}

function formatCost(usd: number): string {
  if (usd === 0) return '$0';
  if (usd < 0.01) return '<$0.01';
  if (usd < 1) return `$${usd.toFixed(2)}`;
  if (usd < 100) return `$${usd.toFixed(2)}`;
  return `$${Math.round(usd).toLocaleString()}`;
}

/**
 * WorkspaceCostSummary — compact strip showing total USD spent across all
 * non-archived sessions in this workspace. Refreshes via a periodic poll
 * because the underlying ai_sessions denormalized totals don't emit a
 * workspace-scoped update event.
 */
export function WorkspaceCostSummary({ workspacePath }: WorkspaceCostSummaryProps) {
  const [summary, setSummary] = useState<WorkspaceCostSummary | null>(null);
  const tooltipId = useId();

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const load = () => {
      void window.electronAPI.cost.getWorkspaceSummary(workspacePath).then((data) => {
        if (cancelled) return;
        setSummary(data);
      });
    };
    load();
    timer = setInterval(load, 30_000);
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, [workspacePath]);

  if (!summary || summary.totalCostUsd <= 0) return null;

  const totalTokens =
    summary.totalInputTokens + summary.totalOutputTokens + summary.totalCacheReadTokens + summary.totalCacheCreateTokens;

  return (
    <div
      className="workspace-cost-summary flex items-center justify-between gap-2 px-3 py-1.5 text-[11px] text-[var(--nim-text-muted)] border-b border-[var(--nim-border)] bg-[var(--nim-bg-secondary)]"
      data-testid="workspace-cost-summary"
      title={`${totalTokens.toLocaleString()} tokens across ${summary.sessionCount} sessions`}
      aria-describedby={tooltipId}
    >
      <span className="flex items-center gap-1.5">
        <MaterialSymbol icon="payments" size={12} />
        <span className="uppercase tracking-wider text-[10px]">Workspace cost</span>
      </span>
      <span className="flex items-center gap-2 tabular-nums">
        <span className="font-semibold text-[var(--nim-text)]">{formatCost(summary.totalCostUsd)}</span>
        <span className="text-[var(--nim-text-faint)]">·</span>
        <span>{summary.sessionCount} session{summary.sessionCount === 1 ? '' : 's'}</span>
      </span>
    </div>
  );
}
