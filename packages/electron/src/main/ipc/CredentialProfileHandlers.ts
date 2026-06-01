import { CredentialProfileService } from '../services/CredentialProfileService';
import { safeHandle } from '../utils/ipcRegistry';
import {
  CREDENTIAL_PROFILE_IPC,
  type CredentialProfile,
  type CreateCredentialProfileInput,
  type UpdateCredentialProfileInput,
  type DeleteProfileResult,
  type ProfileReferences,
} from '../../shared/credentialProfiles';

export function registerCredentialProfileHandlers(): void {
  const service = CredentialProfileService.getInstance();

  safeHandle(CREDENTIAL_PROFILE_IPC.list, (): CredentialProfile[] => {
    return service.list();
  });

  safeHandle(
    CREDENTIAL_PROFILE_IPC.create,
    (_event, input: CreateCredentialProfileInput): CredentialProfile => {
      return service.create(input);
    },
  );

  safeHandle(
    CREDENTIAL_PROFILE_IPC.update,
    (_event, input: UpdateCredentialProfileInput): CredentialProfile => {
      return service.update(input);
    },
  );

  safeHandle(
    CREDENTIAL_PROFILE_IPC.delete,
    async (_event, id: string): Promise<DeleteProfileResult> => {
      return service.delete(id);
    },
  );

  safeHandle(
    CREDENTIAL_PROFILE_IPC.references,
    async (_event, id: string): Promise<ProfileReferences> => {
      return service.findReferences(id);
    },
  );
}
