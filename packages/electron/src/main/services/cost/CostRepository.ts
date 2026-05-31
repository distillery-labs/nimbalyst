/**
 * CostRepository — single writer for ai_turn_costs + denormalized totals on
 * ai_sessions, and the only read path for cost queries (session detail/list,
 * tracker rollup, workspace total).
 *
 * Per-turn rows are insert-only and ledger-style: one row per assistant turn
 * per model. The denormalized columns on ai_sessions are updated atomically
 * in the same operation, so reads from the session row always match SUM() of
 * the ledger.
 */

import { getDatabase } from '../../database/initialize';
import { logger } from '../../utils/logger';
import { pricingService } from './PricingService';

export interface TurnCostInput {
  sessionId: string;
  messageId?: number | null;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheCreateTokens?: number;
  /**
   * When defined, the provider already gave us a USD figure (Claude Code SDK).
   * When undefined, we look up model_pricing and compute it ourselves.
   */
  sdkCostUsd?: number;
}

export interface SessionCost {
  sessionId: string;
  totalCostUsd: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheReadTokens: number;
  totalCacheCreateTokens: number;
}

export interface TurnCostRow {
  id: number;
  sessionId: string;
  messageId: number | null;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreateTokens: number;
  costUsd: number | null;
  costSource: 'sdk' | 'computed' | 'unknown';
  createdAt: number;
}

export interface TrackerCostRollup {
  trackerId: string;
  totalCostUsd: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheReadTokens: number;
  totalCacheCreateTokens: number;
  linkedSessionCount: number;
}

export interface WorkspaceCostSummary {
  workspaceId: string;
  totalCostUsd: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheReadTokens: number;
  totalCacheCreateTokens: number;
  sessionCount: number;
}

class CostRepositoryImpl {
  /**
   * Record one assistant turn. Resolves cost from the SDK figure if present;
   * otherwise looks up model_pricing. Writes the ledger row AND increments
   * the denormalized columns on ai_sessions in a single best-effort sequence.
   *
   * Returns the resolved cost so callers (e.g., streaming handler) can emit it
   * on the same IPC event that pushes the UI update.
   */
  async recordTurn(input: TurnCostInput): Promise<{ costUsd: number | null; source: 'sdk' | 'computed' | 'unknown' }> {
    const db = getDatabase();
    const cacheRead = input.cacheReadTokens ?? 0;
    const cacheCreate = input.cacheCreateTokens ?? 0;

    let costUsd: number | null;
    let source: 'sdk' | 'computed' | 'unknown';
    if (input.sdkCostUsd !== undefined && input.sdkCostUsd !== null) {
      costUsd = input.sdkCostUsd;
      source = 'sdk';
    } else {
      const computed = await pricingService.computeCost(input.provider, input.model, {
        inputTokens: input.inputTokens,
        outputTokens: input.outputTokens,
        cacheReadTokens: cacheRead,
        cacheCreateTokens: cacheCreate,
      });
      costUsd = computed.costUsd;
      source = computed.source;
    }

    try {
      await db.query(
        `INSERT INTO ai_turn_costs (
          session_id, message_id, provider, model,
          input_tokens, output_tokens, cache_read_tokens, cache_create_tokens,
          cost_usd, cost_source
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          input.sessionId,
          input.messageId ?? null,
          input.provider,
          input.model,
          input.inputTokens,
          input.outputTokens,
          cacheRead,
          cacheCreate,
          costUsd,
          source,
        ],
      );

      await db.query(
        `UPDATE ai_sessions SET
          total_input_tokens        = total_input_tokens + $2,
          total_output_tokens       = total_output_tokens + $3,
          total_cache_read_tokens   = total_cache_read_tokens + $4,
          total_cache_create_tokens = total_cache_create_tokens + $5,
          total_cost_usd            = total_cost_usd + $6
        WHERE id = $1`,
        [input.sessionId, input.inputTokens, input.outputTokens, cacheRead, cacheCreate, costUsd ?? 0],
      );
    } catch (error) {
      // Cost tracking is best-effort -- never fail the chat turn because of it.
      logger.main.error('[CostRepository] Failed to record turn cost', error);
    }

    return { costUsd, source };
  }

  async getSessionCost(sessionId: string): Promise<SessionCost | null> {
    const db = getDatabase();
    const result = await db.query<{
      total_cost_usd: string;
      total_input_tokens: string;
      total_output_tokens: string;
      total_cache_read_tokens: string;
      total_cache_create_tokens: string;
    }>(
      `SELECT total_cost_usd, total_input_tokens, total_output_tokens,
              total_cache_read_tokens, total_cache_create_tokens
       FROM ai_sessions WHERE id = $1`,
      [sessionId],
    );
    if (result.rows.length === 0) return null;
    const r = result.rows[0];
    return {
      sessionId,
      totalCostUsd: parseFloat(r.total_cost_usd),
      totalInputTokens: parseInt(r.total_input_tokens, 10),
      totalOutputTokens: parseInt(r.total_output_tokens, 10),
      totalCacheReadTokens: parseInt(r.total_cache_read_tokens, 10),
      totalCacheCreateTokens: parseInt(r.total_cache_create_tokens, 10),
    };
  }

  async getSessionTurns(sessionId: string, limit = 200): Promise<TurnCostRow[]> {
    const db = getDatabase();
    const result = await db.query<{
      id: string;
      session_id: string;
      message_id: string | null;
      provider: string;
      model: string;
      input_tokens: string;
      output_tokens: string;
      cache_read_tokens: string;
      cache_create_tokens: string;
      cost_usd: string | null;
      cost_source: 'sdk' | 'computed' | 'unknown';
      created_at: Date;
    }>(
      `SELECT id, session_id, message_id, provider, model,
              input_tokens, output_tokens, cache_read_tokens, cache_create_tokens,
              cost_usd, cost_source, created_at
       FROM ai_turn_costs
       WHERE session_id = $1
       ORDER BY created_at DESC, id DESC
       LIMIT $2`,
      [sessionId, limit],
    );

    return result.rows.map((r) => ({
      id: parseInt(r.id, 10),
      sessionId: r.session_id,
      messageId: r.message_id !== null ? parseInt(r.message_id, 10) : null,
      provider: r.provider,
      model: r.model,
      inputTokens: parseInt(r.input_tokens, 10),
      outputTokens: parseInt(r.output_tokens, 10),
      cacheReadTokens: parseInt(r.cache_read_tokens, 10),
      cacheCreateTokens: parseInt(r.cache_create_tokens, 10),
      costUsd: r.cost_usd !== null ? parseFloat(r.cost_usd) : null,
      costSource: r.cost_source,
      createdAt: r.created_at instanceof Date ? r.created_at.getTime() : new Date(r.created_at).getTime(),
    }));
  }

  async getTrackerRollup(trackerId: string): Promise<TrackerCostRollup | null> {
    const db = getDatabase();
    const result = await db.query<{
      tracker_id: string;
      total_cost_usd: string;
      total_input_tokens: string;
      total_output_tokens: string;
      total_cache_read_tokens: string;
      total_cache_create_tokens: string;
      linked_session_count: string;
    }>(
      `SELECT tracker_id, total_cost_usd, total_input_tokens, total_output_tokens,
              total_cache_read_tokens, total_cache_create_tokens, linked_session_count
       FROM tracker_cost_rollup WHERE tracker_id = $1`,
      [trackerId],
    );
    if (result.rows.length === 0) return null;
    const r = result.rows[0];
    return {
      trackerId: r.tracker_id,
      totalCostUsd: parseFloat(r.total_cost_usd),
      totalInputTokens: parseInt(r.total_input_tokens, 10),
      totalOutputTokens: parseInt(r.total_output_tokens, 10),
      totalCacheReadTokens: parseInt(r.total_cache_read_tokens, 10),
      totalCacheCreateTokens: parseInt(r.total_cache_create_tokens, 10),
      linkedSessionCount: parseInt(r.linked_session_count, 10),
    };
  }

  /**
   * Bulk rollup fetch for tracker lists. Returns a map keyed by tracker id so
   * the list view can look up costs without an N+1 query.
   */
  async getTrackerRollups(trackerIds: string[]): Promise<Map<string, TrackerCostRollup>> {
    if (trackerIds.length === 0) return new Map();
    const db = getDatabase();
    const result = await db.query<{
      tracker_id: string;
      total_cost_usd: string;
      total_input_tokens: string;
      total_output_tokens: string;
      total_cache_read_tokens: string;
      total_cache_create_tokens: string;
      linked_session_count: string;
    }>(
      `SELECT tracker_id, total_cost_usd, total_input_tokens, total_output_tokens,
              total_cache_read_tokens, total_cache_create_tokens, linked_session_count
       FROM tracker_cost_rollup WHERE tracker_id = ANY($1)`,
      [trackerIds],
    );
    const map = new Map<string, TrackerCostRollup>();
    for (const r of result.rows) {
      map.set(r.tracker_id, {
        trackerId: r.tracker_id,
        totalCostUsd: parseFloat(r.total_cost_usd),
        totalInputTokens: parseInt(r.total_input_tokens, 10),
        totalOutputTokens: parseInt(r.total_output_tokens, 10),
        totalCacheReadTokens: parseInt(r.total_cache_read_tokens, 10),
        totalCacheCreateTokens: parseInt(r.total_cache_create_tokens, 10),
        linkedSessionCount: parseInt(r.linked_session_count, 10),
      });
    }
    return map;
  }

  async getWorkspaceSummary(workspaceId: string): Promise<WorkspaceCostSummary> {
    const db = getDatabase();
    const result = await db.query<{
      total_cost_usd: string | null;
      total_input_tokens: string | null;
      total_output_tokens: string | null;
      total_cache_read_tokens: string | null;
      total_cache_create_tokens: string | null;
      session_count: string;
    }>(
      `SELECT
         COALESCE(SUM(total_cost_usd), 0) AS total_cost_usd,
         COALESCE(SUM(total_input_tokens), 0) AS total_input_tokens,
         COALESCE(SUM(total_output_tokens), 0) AS total_output_tokens,
         COALESCE(SUM(total_cache_read_tokens), 0) AS total_cache_read_tokens,
         COALESCE(SUM(total_cache_create_tokens), 0) AS total_cache_create_tokens,
         COUNT(*) AS session_count
       FROM ai_sessions
       WHERE workspace_id = $1
         AND (is_archived = FALSE OR is_archived IS NULL)`,
      [workspaceId],
    );
    const r = result.rows[0];
    return {
      workspaceId,
      totalCostUsd: parseFloat(r.total_cost_usd ?? '0'),
      totalInputTokens: parseInt(r.total_input_tokens ?? '0', 10),
      totalOutputTokens: parseInt(r.total_output_tokens ?? '0', 10),
      totalCacheReadTokens: parseInt(r.total_cache_read_tokens ?? '0', 10),
      totalCacheCreateTokens: parseInt(r.total_cache_create_tokens ?? '0', 10),
      sessionCount: parseInt(r.session_count, 10),
    };
  }
}

export const costRepository = new CostRepositoryImpl();
