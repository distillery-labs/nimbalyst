/**
 * Credential Profiles end-to-end test.
 *
 * Exercises the Settings → Credentials → Credential Profiles panel:
 * - The panel renders.
 * - User can create an apiKey profile for a provider via the inline form.
 * - The new profile appears in the list.
 * - Deleting an unused profile succeeds.
 * - Deleting a profile referenced by a project override is refused with a
 *   modal listing the referencing workspace.
 *
 * Each test is self-contained — beforeEach wipes profiles and overrides so
 * order doesn't matter, and label collisions from prior failed runs can't
 * leak in.
 */

import { test, expect, type ElectronApplication, type Page } from '@playwright/test';
import {
  launchElectronApp,
  createTempWorkspace,
  waitForAppReady,
  TEST_TIMEOUTS,
} from '../helpers';

test.describe.configure({ mode: 'serial' });

test.describe('Credential Profiles panel', () => {
  let electronApp: ElectronApplication;
  let page: Page;
  let workspaceDir: string;

  test.beforeAll(async () => {
    workspaceDir = await createTempWorkspace();
    electronApp = await launchElectronApp({ workspace: workspaceDir });
    page = await electronApp.firstWindow();
    await waitForAppReady(page);
  });

  test.afterAll(async () => {
    await electronApp?.close().catch(() => undefined);
  });

  test.beforeEach(async () => {
    // Reset all profiles + every workspace's overrides. Defends against leftover
    // state from prior failed runs (which can cause spurious label collisions
    // or false-positive "still in use" refused-delete responses).
    await page.evaluate(async (workspacePath) => {
      await (window as any).electronAPI.invoke('ai:saveProjectSettings', workspacePath, { providers: {} });
      const list = (await (window as any).electronAPI.invoke('credentials:list')) as Array<{ id: string }>;
      for (const p of list) {
        const refs = (await (window as any).electronAPI.invoke('credentials:references', p.id)) as {
          projects: Array<{ workspacePath: string }>;
        };
        for (const r of refs.projects) {
          await (window as any).electronAPI.invoke('ai:saveProjectSettings', r.workspacePath, { providers: {} });
        }
        await (window as any).electronAPI.invoke('credentials:delete', p.id);
      }
    }, workspaceDir);
  });

  async function openCredentialProfilesPanel() {
    await page.evaluate(() => {
      const helpers = (window as any).__testHelpers;
      helpers.setActiveMode('files');
    });
    await page.waitForTimeout(150);
    await page.evaluate(() => {
      const helpers = (window as any).__testHelpers;
      helpers.openSettings('credential-profiles', 'user');
    });
    await page.waitForSelector('.credential-profiles-panel', { timeout: TEST_TIMEOUTS.SIDEBAR_LOAD });
  }

  test('opens Settings → Credential Profiles', async () => {
    await openCredentialProfilesPanel();
    await expect(page.locator('.credential-profiles-panel >> text=Credential Profiles')).toBeVisible();
  });

  test('creates an apiKey profile via the inline form', async () => {
    await openCredentialProfilesPanel();

    const claudeAgentGroup = page.locator('.credential-provider-group').filter({ hasText: 'Claude Agent' });
    await expect(claudeAgentGroup).toBeVisible();
    await claudeAgentGroup.locator('button:has-text("+ New profile")').click();

    const form = claudeAgentGroup.locator('.credential-profile-form');
    await expect(form).toBeVisible();
    await form.locator('input[type="text"]').fill('E2E Test Profile');
    await form.locator('input[type="password"]').fill('sk-ant-e2e-test-key');
    await form.locator('button:has-text("Create profile")').click();

    const row = claudeAgentGroup.locator('.profile-row').filter({ hasText: 'E2E Test Profile' });
    await expect(row).toBeVisible({ timeout: 3000 });
  });

  test('deletes an unused profile', async () => {
    // Seed via IPC (faster than driving the form), then open the panel.
    await page.evaluate(async () => {
      await (window as any).electronAPI.invoke('credentials:create', {
        label: 'E2E Unused',
        providerId: 'claude-code',
        kind: 'apiKey',
        apiKey: { value: 'sk-ant-unused' },
      });
    });
    await openCredentialProfilesPanel();

    const claudeAgentGroup = page.locator('.credential-provider-group').filter({ hasText: 'Claude Agent' });
    const row = claudeAgentGroup.locator('.profile-row').filter({ hasText: 'E2E Unused' });
    await expect(row).toBeVisible();

    await row.locator('button[aria-label="Delete profile"]').click();
    await expect(row).not.toBeVisible({ timeout: 3000 });
    await expect(page.locator('.credential-references-modal')).not.toBeVisible();
  });

  test('refuses to delete a profile that is referenced by a project override', async () => {
    // Seed: create a profile and point the workspace's claude-code override at it.
    await page.evaluate(async (workspacePath) => {
      const profile = (await (window as any).electronAPI.invoke('credentials:create', {
        label: 'E2E Referenced',
        providerId: 'claude-code',
        kind: 'apiKey',
        apiKey: { value: 'sk-ant-referenced' },
      })) as { id: string };
      await (window as any).electronAPI.invoke('ai:saveProjectSettings', workspacePath, {
        providers: {
          'claude-code': { credentialProfileId: profile.id },
        },
      });
    }, workspaceDir);

    await openCredentialProfilesPanel();

    const claudeAgentGroup = page.locator('.credential-provider-group').filter({ hasText: 'Claude Agent' });
    const row = claudeAgentGroup.locator('.profile-row').filter({ hasText: 'E2E Referenced' });
    await expect(row).toBeVisible();
    await row.locator('button[aria-label="Delete profile"]').click();

    const modal = page.locator('.credential-references-modal');
    await expect(modal).toBeVisible({ timeout: 3000 });
    await expect(modal).toContainText('still in use');
    await expect(modal).toContainText(workspaceDir);

    await modal.locator('button:has-text("Got it")').click();
    await expect(row).toBeVisible();
  });
});
