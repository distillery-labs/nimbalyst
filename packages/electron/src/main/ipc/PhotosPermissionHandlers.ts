/**
 * IPC handlers for the macOS Photos library TCC grant.
 *
 * Background: Nimbalyst's Info.plist declares NSPhotoLibraryUsageDescription
 * and the bundle entitlements include com.apple.security.personal-information
 * .photos-library. With those in place, macOS *will* attribute Photos access
 * to Nimbalyst.app and allow direct reads of ~/Pictures/Photos Library… —
 * but only after the user has granted access. The grant is never offered
 * implicitly; it requires a real PhotoKit `requestAuthorization` call from a
 * process whose Info.plist carries the usage description.
 *
 * Electron's systemPreferences.askForMediaAccess does NOT support 'photos'
 * (only 'microphone' | 'camera' | 'screen'), so we route through the
 * `node-mac-permissions` native addon, which runs inside Nimbalyst's own
 * process — meaning the PhotoKit call sees Nimbalyst's plist and the prompt
 * is recorded against Nimbalyst.app's TCC identity.
 *
 * Once granted, every child process Nimbalyst spawns via host.exec inherits
 * the Photos access (TCC attribution to the parent app bundle), which is
 * what lets the apple-photos extension read Photos.sqlite directly.
 *
 * The require is wrapped in try/catch because `node-mac-permissions` is a
 * native addon and may not be installed yet. The handlers degrade to a
 * clean "module-not-installed" response so the rest of Nimbalyst keeps
 * working until the dependency is added and the app is rebuilt.
 */

import { shell } from 'electron';
import { safeHandle } from '../utils/ipcRegistry';

export type PhotosAccessStatus =
  | 'not-determined'
  | 'authorized'
  | 'denied'
  | 'restricted'
  | 'limited'
  | 'unknown';

type MacPermissions = {
  getAuthStatus: (kind: 'photos' | 'photos-add-only' | string) => string;
  askForPhotosAccess: (level?: 'read-only' | 'read-write') => Promise<string>;
};

let permissions: MacPermissions | null = null;
let loadError: string | null = null;
try {
  // Lazy require so a missing native module doesn't abort the whole main
  // process. The addon ships per-arch prebuilds via prebuild-install.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  permissions = require('node-mac-permissions') as MacPermissions;
} catch (err) {
  loadError = err instanceof Error ? err.message : String(err);
}

function normalizeStatus(raw: string | undefined): PhotosAccessStatus {
  switch (raw) {
    case 'authorized':
      return 'authorized';
    case 'denied':
      return 'denied';
    case 'restricted':
      return 'restricted';
    case 'limited':
      return 'limited';
    case 'not determined':
    case 'not-determined':
      return 'not-determined';
    default:
      return 'unknown';
  }
}

export function initPhotosPermissionHandlers() {
  /**
   * Read the current Photos access status without prompting.
   * Safe to call on every panel mount.
   */
  safeHandle('photos:get-access-status', async () => {
    if (process.platform !== 'darwin') {
      return { status: 'unknown' as PhotosAccessStatus, platform: process.platform };
    }
    if (!permissions) {
      return {
        status: 'unknown' as PhotosAccessStatus,
        platform: 'darwin',
        error: `node-mac-permissions not loaded: ${loadError ?? 'unknown reason'}`,
      };
    }
    try {
      const raw = permissions.getAuthStatus('photos');
      return { status: normalizeStatus(raw), platform: 'darwin' };
    } catch (err) {
      return {
        status: 'unknown' as PhotosAccessStatus,
        platform: 'darwin',
        error: err instanceof Error ? err.message : String(err),
      };
    }
  });

  /**
   * Trigger the macOS Photos access prompt. Resolves when the user responds
   * (or immediately if a decision has already been recorded). The grant is
   * tied to Nimbalyst.app's bundle identity and is inherited by spawned
   * child processes — that's what unblocks extensions reading Photos.sqlite.
   */
  safeHandle('photos:request-access', async () => {
    if (process.platform !== 'darwin') {
      return { status: 'unknown' as PhotosAccessStatus, platform: process.platform };
    }
    if (!permissions) {
      return {
        status: 'unknown' as PhotosAccessStatus,
        platform: 'darwin',
        error: `node-mac-permissions not loaded: ${loadError ?? 'unknown reason'}`,
      };
    }
    try {
      // Read-write so the helper / extensions can both read the library and
      // (later) write keywords, captions, album membership.
      const raw = await permissions.askForPhotosAccess('read-write');
      return { status: normalizeStatus(raw), platform: 'darwin' };
    } catch (err) {
      return {
        status: 'unknown' as PhotosAccessStatus,
        platform: 'darwin',
        error: err instanceof Error ? err.message : String(err),
      };
    }
  });

  /**
   * Open the macOS System Settings pane for Photos privacy so the user can
   * change a denied grant. Mirrors the voice-mode:open-mic-settings shape.
   */
  safeHandle('photos:open-system-settings', async () => {
    if (process.platform !== 'darwin') {
      return { success: false, error: `unsupported platform: ${process.platform}` };
    }
    await shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_Photos');
    return { success: true };
  });
}
