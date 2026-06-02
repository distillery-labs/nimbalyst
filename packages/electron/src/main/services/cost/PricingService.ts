/**
 * PricingService — converts (provider, model, token counts) into a USD cost
 * using the rows in the `model_pricing` table.
 *
 * The Claude Code SDK reports `costUSD` directly in its `modelUsage` result; we
 * pass that through unchanged with cost_source='sdk'. Every other provider gives
 * us raw token counts only, so this service is what produces the USD figure for
 * them (cost_source='computed'). When a model isn't in the pricing table we
 * return `null` for cost (cost_source='unknown') rather than fabricating a $0.
 */

import { getDatabase } from '../../database/initialize';
import { logger } from '../../utils/logger';

export interface ModelPricing {
  provider: string;
  modelId: string;
  inputPerMTok: number;
  outputPerMTok: number;
  cacheReadPerMTok: number | null;
  cacheCreatePerMTok: number | null;
}

export interface TokenCounts {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheCreateTokens?: number;
}

export interface CostResult {
  costUsd: number | null;
  source: 'computed' | 'unknown';
  pricing: ModelPricing | null;
}

class PricingServiceImpl {
  private cache = new Map<string, ModelPricing | null>();
  private loadedAt = 0;
  private static readonly TTL_MS = 5 * 60 * 1000;

  private key(provider: string, modelId: string): string {
    return `${provider}::${modelId}`;
  }

  private async refreshIfStale(): Promise<void> {
    if (Date.now() - this.loadedAt < PricingServiceImpl.TTL_MS && this.cache.size > 0) return;
    const db = getDatabase();
    const result = await db.query<{
      provider: string;
      model_id: string;
      input_per_mtok: string;
      output_per_mtok: string;
      cache_read_per_mtok: string | null;
      cache_create_per_mtok: string | null;
    }>(`SELECT provider, model_id, input_per_mtok, output_per_mtok, cache_read_per_mtok, cache_create_per_mtok FROM model_pricing`);

    this.cache.clear();
    for (const row of result.rows) {
      this.cache.set(this.key(row.provider, row.model_id), {
        provider: row.provider,
        modelId: row.model_id,
        inputPerMTok: parseFloat(row.input_per_mtok),
        outputPerMTok: parseFloat(row.output_per_mtok),
        cacheReadPerMTok: row.cache_read_per_mtok !== null ? parseFloat(row.cache_read_per_mtok) : null,
        cacheCreatePerMTok: row.cache_create_per_mtok !== null ? parseFloat(row.cache_create_per_mtok) : null,
      });
    }
    this.loadedAt = Date.now();
    logger.main.info(`[PricingService] Loaded ${this.cache.size} pricing rows`);
  }

  async getPricing(provider: string, modelId: string): Promise<ModelPricing | null> {
    await this.refreshIfStale();
    return this.cache.get(this.key(provider, modelId)) ?? null;
  }

  async listAll(): Promise<ModelPricing[]> {
    await this.refreshIfStale();
    return Array.from(this.cache.values()).filter((v): v is ModelPricing => v !== null);
  }

  async computeCost(provider: string, modelId: string, tokens: TokenCounts): Promise<CostResult> {
    const pricing = await this.getPricing(provider, modelId);
    if (!pricing) {
      return { costUsd: null, source: 'unknown', pricing: null };
    }

    const M = 1_000_000;
    const inputCost = (tokens.inputTokens / M) * pricing.inputPerMTok;
    const outputCost = (tokens.outputTokens / M) * pricing.outputPerMTok;
    const cacheReadCost =
      tokens.cacheReadTokens && pricing.cacheReadPerMTok !== null
        ? (tokens.cacheReadTokens / M) * pricing.cacheReadPerMTok
        : 0;
    const cacheCreateCost =
      tokens.cacheCreateTokens && pricing.cacheCreatePerMTok !== null
        ? (tokens.cacheCreateTokens / M) * pricing.cacheCreatePerMTok
        : 0;

    const costUsd = inputCost + outputCost + cacheReadCost + cacheCreateCost;
    return { costUsd, source: 'computed', pricing };
  }

  invalidate(): void {
    this.loadedAt = 0;
    this.cache.clear();
  }
}

export const pricingService = new PricingServiceImpl();
