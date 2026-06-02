import { safeHandle } from '../utils/ipcRegistry';
import {
  costRepository,
  type SessionCost,
  type TurnCostRow,
  type TrackerCostRollup,
  type WorkspaceCostSummary,
} from '../services/cost/CostRepository';
import { pricingService, type ModelPricing } from '../services/cost/PricingService';

export function registerCostHandlers() {
  safeHandle('cost:getSessionCost', (_e, sessionId: string): Promise<SessionCost | null> => {
    return costRepository.getSessionCost(sessionId);
  });

  safeHandle('cost:getSessionTurns', (_e, sessionId: string, limit?: number): Promise<TurnCostRow[]> => {
    return costRepository.getSessionTurns(sessionId, limit ?? 200);
  });

  safeHandle('cost:getTrackerRollup', (_e, trackerId: string): Promise<TrackerCostRollup | null> => {
    return costRepository.getTrackerRollup(trackerId);
  });

  safeHandle(
    'cost:getTrackerRollups',
    async (_e, trackerIds: string[]): Promise<Record<string, TrackerCostRollup>> => {
      const map = await costRepository.getTrackerRollups(trackerIds);
      const out: Record<string, TrackerCostRollup> = {};
      for (const [k, v] of map) out[k] = v;
      return out;
    },
  );

  safeHandle('cost:getWorkspaceSummary', (_e, workspaceId: string): Promise<WorkspaceCostSummary> => {
    return costRepository.getWorkspaceSummary(workspaceId);
  });

  safeHandle('cost:listPricing', (): Promise<ModelPricing[]> => {
    return pricingService.listAll();
  });
}
