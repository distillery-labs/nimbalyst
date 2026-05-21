/**
 * Mode toggle binary cycle E2E (issue #371).
 *
 * Verifies:
 * - ModeTag is rendered when provider === 'claude-code' and a session exists
 * - Click cycles Plan -> Agent -> Plan (binary toggle)
 * - Shift+Tab cycles the same order
 * - Selected mode persists across a page reload
 *
 * Auto mode is activated transparently via the "Allow All" trust level and
 * does not appear in the toggle cycle. Backend classifier logic is covered
 * by unit tests (AgentToolHooks.test.ts, immediateToolDecision.test.ts).
 */

import { test, expect } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import {
  launchElectronApp,
  createTempWorkspace,
  waitForAppReady,
  dismissProjectTrustToast,
} from '../helpers';
import {
  switchToAgentMode,
  createNewAgentSession,
  dismissAPIKeyDialog,
  waitForWorkspaceReady,
} from '../utils/testHelpers';
import * as fs from 'fs/promises';

let electronApp: ElectronApplication;
let page: Page;
let workspacePath: string;

test.beforeAll(async () => {
  workspacePath = await createTempWorkspace('mode-toggle-cycle');
  electronApp = await launchElectronApp({ workspacePath });
  page = await electronApp.firstWindow();
  await waitForAppReady(page);
  await dismissProjectTrustToast(page);
  await dismissAPIKeyDialog(page);
  await waitForWorkspaceReady(page);
  await switchToAgentMode(page);
  await createNewAgentSession(page);
});

test.afterAll(async () => {
  await electronApp?.close();
  if (workspacePath) {
    await fs.rm(workspacePath, { recursive: true, force: true });
  }
});

test('ModeTag cycles Plan -> Agent -> Plan on click', async () => {
  const modeTag = page.getByTestId('plan-mode-toggle');
  await expect(modeTag).toBeVisible();

  const initialMode = await modeTag.getAttribute('data-mode');
  const cycle: Record<string, string> = {
    planning: 'agent',
    agent: 'planning',
  };

  let current = initialMode!;
  for (let i = 0; i < 2; i++) {
    await modeTag.click();
    const next = cycle[current];
    await expect(modeTag).toHaveAttribute('data-mode', next);
    current = next;
  }
  expect(current).toBe(initialMode);
});

test('Shift+Tab cycles modes same as click', async () => {
  const modeTag = page.getByTestId('plan-mode-toggle');
  const startMode = await modeTag.getAttribute('data-mode');
  const cycle: Record<string, string> = {
    planning: 'agent',
    agent: 'planning',
  };

  const aiInput = page.locator('textarea').first();
  await aiInput.focus();
  await page.keyboard.press('Shift+Tab');
  await expect(modeTag).toHaveAttribute('data-mode', cycle[startMode!]);
});

test('Mode persists across reload', async () => {
  const modeTag = page.getByTestId('plan-mode-toggle');
  // Ensure we're on a known mode (planning).
  const current = await modeTag.getAttribute('data-mode');
  if (current !== 'planning') {
    await modeTag.click();
  }
  await expect(modeTag).toHaveAttribute('data-mode', 'planning');

  await page.reload();
  await waitForAppReady(page);
  await switchToAgentMode(page);

  const reloadedTag = page.getByTestId('plan-mode-toggle');
  await expect(reloadedTag).toBeVisible();
  await expect(reloadedTag).toHaveAttribute('data-mode', 'planning');
});
