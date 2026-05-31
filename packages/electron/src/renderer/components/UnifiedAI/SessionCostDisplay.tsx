import React, { useId, useState, useRef, useCallback } from 'react';

interface SessionCostDisplayProps {
  /** Running cost in USD. Undefined means "no data yet". */
  costUsd?: number;
  /** Optional token breakdown for the tooltip. */
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheCreateTokens?: number;
}

function formatCost(usd: number): string {
  if (usd === 0) return '$0';
  if (usd < 0.01) return '<$0.01';
  if (usd < 1) return `$${usd.toFixed(2)}`;
  if (usd < 100) return `$${usd.toFixed(2)}`;
  return `$${Math.round(usd)}`;
}

/**
 * SessionCostDisplay — pill showing running USD cost for the active session.
 *
 * Lives next to ContextUsageDisplay in the chat header. The cost number itself
 * comes from `tokenUsage.costUSD` which is pushed live via the existing
 * `ai:tokenUsageUpdated` IPC, so this component is a pure renderer — no fetch.
 */
export function SessionCostDisplay({
  costUsd,
  inputTokens = 0,
  outputTokens = 0,
  cacheReadTokens = 0,
  cacheCreateTokens = 0,
}: SessionCostDisplayProps) {
  const [tooltipVisible, setTooltipVisible] = useState(false);
  const tooltipId = useId();
  const hideTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const hasCost = costUsd !== undefined && costUsd !== null;
  const displayText = hasCost ? formatCost(costUsd!) : '--';
  const hasBreakdown = inputTokens > 0 || outputTokens > 0 || cacheReadTokens > 0 || cacheCreateTokens > 0;
  const enableTooltip = hasCost && hasBreakdown;
  const shouldShowTooltip = tooltipVisible && enableTooltip;

  const clearHideTimeout = useCallback(() => {
    if (hideTimeoutRef.current) {
      clearTimeout(hideTimeoutRef.current);
      hideTimeoutRef.current = null;
    }
  }, []);

  const handleMouseEnter = useCallback(() => {
    clearHideTimeout();
    if (enableTooltip) setTooltipVisible(true);
  }, [enableTooltip, clearHideTimeout]);

  const handleMouseLeave = useCallback(() => {
    hideTimeoutRef.current = setTimeout(() => setTooltipVisible(false), 150);
  }, []);

  return (
    <div
      className="session-cost-display relative inline-flex items-center py-0.5 px-2 rounded-md text-[11px] font-medium whitespace-nowrap bg-[var(--nim-bg-secondary)] border border-[var(--nim-border)] cursor-default gap-1 focus:outline-2 focus:outline-[var(--nim-primary)] focus:outline-offset-2 max-[400px]:hidden"
      tabIndex={hasCost ? 0 : -1}
      aria-label={hasCost ? `Session cost ${displayText}` : 'Cost data not available yet'}
      aria-describedby={shouldShowTooltip ? tooltipId : undefined}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onFocus={handleMouseEnter}
      onBlur={handleMouseLeave}
      role="group"
      data-testid="session-cost-indicator"
    >
      <span className="cost-text text-[var(--nim-text-muted)] tabular-nums">{displayText}</span>

      {shouldShowTooltip && (
        <div
          className="session-cost-tooltip absolute right-0 bottom-[calc(100%+8px)] w-[240px] max-w-[calc(100vw-32px)] p-3 rounded-[10px] bg-[var(--nim-bg)] border border-[var(--nim-border)] shadow-[0_12px_32px_rgba(0,0,0,0.35)] z-10 text-[var(--nim-text)]"
          id={tooltipId}
          role="tooltip"
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
        >
          <div className="cost-tooltip-header flex justify-between items-center text-xs mb-2 text-[var(--nim-text-muted)]">
            <span>Session Cost</span>
            <span className="font-semibold text-[var(--nim-text)] tabular-nums">{displayText}</span>
          </div>
          <div className="cost-tooltip-rows flex flex-col gap-1 text-[11px]">
            <TokenRow label="Input" tokens={inputTokens} />
            <TokenRow label="Output" tokens={outputTokens} />
            {cacheReadTokens > 0 && <TokenRow label="Cache read" tokens={cacheReadTokens} />}
            {cacheCreateTokens > 0 && <TokenRow label="Cache write" tokens={cacheCreateTokens} />}
          </div>
        </div>
      )}
    </div>
  );
}

function TokenRow({ label, tokens }: { label: string; tokens: number }) {
  return (
    <div className="cost-tooltip-row flex justify-between text-[11px]">
      <span className="text-[var(--nim-text-muted)]">{label}:</span>
      <span className="text-[var(--nim-text)] tabular-nums">{tokens.toLocaleString()}</span>
    </div>
  );
}
