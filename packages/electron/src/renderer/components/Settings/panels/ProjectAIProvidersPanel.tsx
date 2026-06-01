import React, { useState, useEffect } from 'react';
import { MaterialSymbol, getProviderIcon } from '@nimbalyst/runtime';
import {
  CREDENTIAL_PROFILE_IPC,
  type CredentialProfile,
  type CreateCredentialProfileInput,
} from '../../../../shared/credentialProfiles';

interface ProviderOverride {
  enabled?: boolean;
  models?: string[];
  defaultModel?: string;
  /** Legacy inline key. Preserved for one release; new selections use credentialProfileId. */
  apiKey?: string;
  credentialProfileId?: string;
}

interface AIProviderOverrides {
  defaultProvider?: string;
  providers?: Record<string, ProviderOverride>;
}

interface GlobalProviderSettings {
  enabled?: boolean;
  models?: string[];
  defaultModel?: string;
}

interface Model {
  id: string;
  name: string;
  provider: string;
}

interface TrackerAutomationOverride {
  enabled?: boolean;
  autoCloseOnCommit?: boolean;
}

interface ProjectAIProvidersPanelProps {
  workspacePath: string;
  workspaceName: string;
}

interface ProviderInfo {
  id: string;
  name: string;
  subtitle: string;
  apiKeyField?: string; // The key name in apiKeys (e.g., 'anthropic', 'openai')
}

const PROVIDERS: ProviderInfo[] = [
  { id: 'claude-code', name: 'Claude Agent', subtitle: 'CLI-based MCP', apiKeyField: 'claude-code' },
  { id: 'claude', name: 'Claude', subtitle: 'Anthropic API', apiKeyField: 'anthropic' },
  { id: 'openai', name: 'OpenAI', subtitle: 'GPT Models', apiKeyField: 'openai' },
  { id: 'lmstudio', name: 'LM Studio', subtitle: 'Local Models' },
];

export function ProjectAIProvidersPanel({ workspacePath, workspaceName }: ProjectAIProvidersPanelProps) {
  const [globalSettings, setGlobalSettings] = useState<Record<string, GlobalProviderSettings>>({});
  const [globalApiKeys, setGlobalApiKeys] = useState<Record<string, string>>({});
  const [projectOverrides, setProjectOverrides] = useState<AIProviderOverrides>({});
  const [credentialProfiles, setCredentialProfiles] = useState<CredentialProfile[]>([]);
  /** Per-provider, transient: user chose to enter a new key inline (creates a profile on save). */
  const [newKeyInput, setNewKeyInput] = useState<Record<string, string>>({});
  const [newKeyLabel, setNewKeyLabel] = useState<Record<string, string>>({});
  const [availableModels, setAvailableModels] = useState<Record<string, Model[]>>({});
  const [expandedProvider, setExpandedProvider] = useState<string | null>(null);
  const [trackerAutomationOverride, setTrackerAutomationOverride] = useState<TrackerAutomationOverride | null>(null);
  const [hasChanges, setHasChanges] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadSettings();
  }, [workspacePath]);

  const loadSettings = async () => {
    setLoading(true);
    try {
      // Load global settings
      const globalResult = await window.electronAPI.aiGetSettings();
      if (globalResult.providerSettings) {
        setGlobalSettings(globalResult.providerSettings);
      }
      if (globalResult.apiKeys) {
        setGlobalApiKeys(globalResult.apiKeys);
      }

      // Load credential profiles
      try {
        const profiles = (await window.electronAPI.invoke(CREDENTIAL_PROFILE_IPC.list)) as CredentialProfile[];
        setCredentialProfiles(Array.isArray(profiles) ? profiles : []);
      } catch (err) {
        console.error('Failed to load credential profiles:', err);
      }

      // Load project overrides
      const projectResult = await window.electronAPI.invoke('ai:getProjectSettings', workspacePath);
      if (projectResult.success && projectResult.overrides) {
        setProjectOverrides(projectResult.overrides);
      } else {
        setProjectOverrides({});
      }

      // Load tracker automation override
      try {
        const trackerResult = await window.electronAPI.invoke('ai:getProjectTrackerAutomation', workspacePath);
        if (trackerResult.success) {
          setTrackerAutomationOverride(trackerResult.override);
        }
      } catch (err) {
        console.error('Failed to load tracker automation override:', err);
      }

      // Load available models
      try {
        const modelsResult = await window.electronAPI.aiGetAllModels();
        if (modelsResult.success && modelsResult.grouped) {
          setAvailableModels(modelsResult.grouped);
        }
      } catch (err) {
        console.error('Failed to load models:', err);
      }
    } catch (error) {
      console.error('Failed to load AI provider settings:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await window.electronAPI.invoke('ai:saveProjectSettings', workspacePath, projectOverrides);
      await window.electronAPI.invoke('ai:saveProjectTrackerAutomation', workspacePath, trackerAutomationOverride);
      setHasChanges(false);
    } catch (error) {
      console.error('Failed to save project AI settings:', error);
    } finally {
      setSaving(false);
    }
  };

  const isOverriding = (providerId: string): boolean => {
    return projectOverrides.providers?.[providerId] !== undefined;
  };

  const getOverride = (providerId: string): ProviderOverride | undefined => {
    return projectOverrides.providers?.[providerId];
  };

  const getEffectiveEnabled = (providerId: string): boolean => {
    const override = getOverride(providerId);
    if (override?.enabled !== undefined) {
      return override.enabled;
    }
    return globalSettings[providerId]?.enabled ?? false;
  };

  const getEffectiveApiKey = (providerId: string, apiKeyField?: string): string => {
    const override = getOverride(providerId);
    if (override?.apiKey) {
      return override.apiKey;
    }
    return apiKeyField ? (globalApiKeys[apiKeyField] || '') : '';
  };

  const getEffectiveModels = (providerId: string): string[] => {
    const override = getOverride(providerId);
    if (override?.models) {
      return override.models;
    }
    return globalSettings[providerId]?.models || [];
  };

  const handleOverrideToggle = (providerId: string, override: boolean) => {
    setProjectOverrides(prev => {
      const newOverrides = { ...prev };
      if (!newOverrides.providers) {
        newOverrides.providers = {};
      }

      if (override) {
        // Initialize override with current global values
        const globalProvider = globalSettings[providerId] || {};
        const provider = PROVIDERS.find(p => p.id === providerId);
        newOverrides.providers[providerId] = {
          enabled: globalProvider.enabled ?? false,
          models: globalProvider.models ? [...globalProvider.models] : [],
          apiKey: '', // Don't copy global API key, let user enter project-specific one
        };
      } else {
        // Remove override
        delete newOverrides.providers[providerId];
        if (Object.keys(newOverrides.providers).length === 0) {
          delete newOverrides.providers;
        }
      }

      return newOverrides;
    });
    setHasChanges(true);
  };

  const handleEnabledChange = (providerId: string, enabled: boolean) => {
    setProjectOverrides(prev => {
      const newOverrides = { ...prev };
      if (!newOverrides.providers) newOverrides.providers = {};
      if (!newOverrides.providers[providerId]) newOverrides.providers[providerId] = {};
      newOverrides.providers[providerId].enabled = enabled;
      return newOverrides;
    });
    setHasChanges(true);
  };

  const handleApiKeyChange = (providerId: string, apiKey: string) => {
    setProjectOverrides(prev => {
      const newOverrides = { ...prev };
      if (!newOverrides.providers) newOverrides.providers = {};
      if (!newOverrides.providers[providerId]) newOverrides.providers[providerId] = {};
      newOverrides.providers[providerId].apiKey = apiKey;
      return newOverrides;
    });
    setHasChanges(true);
  };

  const handleSelectProfile = (providerId: string, profileId: string | null) => {
    setProjectOverrides(prev => {
      const newOverrides = { ...prev };
      if (!newOverrides.providers) newOverrides.providers = {};
      if (!newOverrides.providers[providerId]) newOverrides.providers[providerId] = {};
      if (profileId) {
        newOverrides.providers[providerId].credentialProfileId = profileId;
        delete newOverrides.providers[providerId].apiKey;
      } else {
        delete newOverrides.providers[providerId].credentialProfileId;
        delete newOverrides.providers[providerId].apiKey;
      }
      return newOverrides;
    });
    setNewKeyInput(prev => ({ ...prev, [providerId]: '' }));
    setNewKeyLabel(prev => ({ ...prev, [providerId]: '' }));
    setHasChanges(true);
  };

  const handleCreateInlineProfile = async (provider: ProviderInfo) => {
    const value = newKeyInput[provider.id]?.trim();
    const label = newKeyLabel[provider.id]?.trim() || `${workspaceName} – ${provider.name}`;
    if (!value || !provider.apiKeyField) return;
    try {
      const input: CreateCredentialProfileInput = {
        label,
        providerId: provider.id,
        kind: 'apiKey',
        apiKey: { value },
      };
      const profile = (await window.electronAPI.invoke(
        CREDENTIAL_PROFILE_IPC.create,
        input,
      )) as CredentialProfile;
      setCredentialProfiles(prev => [...prev, profile]);
      handleSelectProfile(provider.id, profile.id);
    } catch (err) {
      console.error('Failed to create credential profile:', err);
      alert(`Failed to create profile: ${(err as Error).message}`);
    }
  };

  const handleConvertLegacyKey = async (provider: ProviderInfo) => {
    const override = getOverride(provider.id);
    if (!override?.apiKey) return;
    try {
      const input: CreateCredentialProfileInput = {
        label: `${workspaceName} – ${provider.name}`,
        providerId: provider.id,
        kind: 'apiKey',
        apiKey: { value: override.apiKey },
      };
      const profile = (await window.electronAPI.invoke(
        CREDENTIAL_PROFILE_IPC.create,
        input,
      )) as CredentialProfile;
      setCredentialProfiles(prev => [...prev, profile]);
      handleSelectProfile(provider.id, profile.id);
    } catch (err) {
      console.error('Failed to convert legacy key:', err);
      alert(`Failed to convert key: ${(err as Error).message}`);
    }
  };

  const handleModelToggle = (providerId: string, modelId: string, enabled: boolean) => {
    setProjectOverrides(prev => {
      const newOverrides = { ...prev };
      if (!newOverrides.providers) newOverrides.providers = {};
      if (!newOverrides.providers[providerId]) newOverrides.providers[providerId] = {};

      const currentModels = newOverrides.providers[providerId].models || [];
      if (enabled) {
        newOverrides.providers[providerId].models = [...currentModels, modelId];
      } else {
        newOverrides.providers[providerId].models = currentModels.filter(m => m !== modelId);
      }
      return newOverrides;
    });
    setHasChanges(true);
  };

  const handleSelectAllModels = (providerId: string, selectAll: boolean) => {
    const models = availableModels[providerId] || [];
    setProjectOverrides(prev => {
      const newOverrides = { ...prev };
      if (!newOverrides.providers) newOverrides.providers = {};
      if (!newOverrides.providers[providerId]) newOverrides.providers[providerId] = {};
      newOverrides.providers[providerId].models = selectAll ? models.map(m => m.id) : [];
      return newOverrides;
    });
    setHasChanges(true);
  };

  const hasAnyOverrides = () => {
    return (projectOverrides.providers && Object.keys(projectOverrides.providers).length > 0) ||
           projectOverrides.defaultProvider !== undefined;
  };

  if (loading) {
    return (
      <div className="project-ai-providers-panel flex flex-col h-full p-6 gap-6">
        <div className="panel-loading flex items-center justify-center h-[200px] text-[var(--nim-text-muted)]">Loading settings...</div>
      </div>
    );
  }

  return (
    <div className="project-ai-providers-panel flex flex-col h-full p-6 gap-6">
      <div className="panel-header">
        <h2 className="m-0 mb-2 text-lg font-semibold text-[var(--nim-text)]">AI Providers</h2>
        <p className="panel-description m-0 text-[13px] text-[var(--nim-text-muted)] leading-normal">
          Override AI provider settings for <strong className="text-[var(--nim-text)] font-medium">{workspaceName}</strong>.
          Enable overrides to use different API keys or models for this project.
        </p>
      </div>

      <div className="panel-content flex-1 overflow-y-auto">
        <div className="providers-list flex flex-col gap-3">
          {PROVIDERS.map(provider => {
            const globalEnabled = globalSettings[provider.id]?.enabled ?? false;
            const overriding = isOverriding(provider.id);
            const effectiveEnabled = getEffectiveEnabled(provider.id);
            const isExpanded = expandedProvider === provider.id;
            const override = getOverride(provider.id);
            const models = availableModels[provider.id] || [];
            const selectedModels = getEffectiveModels(provider.id);

            return (
              <div
                key={provider.id}
                className={`provider-card rounded-lg overflow-hidden transition-colors duration-150 bg-[var(--nim-bg-secondary)] border ${overriding ? 'border-[var(--nim-primary)]' : 'border-[var(--nim-border)]'}`}
              >
                {/* Provider Header - Always Visible */}
                <div
                  className="provider-card-header flex items-center justify-between p-4 cursor-pointer transition-colors duration-150 hover:bg-[var(--nim-bg-hover)]"
                  onClick={() => setExpandedProvider(isExpanded ? null : provider.id)}
                >
                  <div className="provider-info flex items-center gap-3">
                    <span className="provider-icon flex items-center justify-center w-10 h-10 bg-[var(--nim-bg-tertiary)] rounded-lg">
                      {getProviderIcon(provider.id as any, { size: 24 })}
                    </span>
                    <div className="provider-details flex flex-col gap-0.5">
                      <span className="provider-name text-sm font-medium text-[var(--nim-text)]">{provider.name}</span>
                      <span className="provider-subtitle text-xs text-[var(--nim-text-faint)]">{provider.subtitle}</span>
                    </div>
                  </div>

                  <div className="provider-status flex items-center gap-2.5">
                    <span className={`global-status text-[11px] px-2 py-0.5 rounded font-medium ${globalEnabled ? 'bg-[rgba(34,197,94,0.12)] text-[#22c55e]' : 'bg-[var(--nim-bg-tertiary)] text-[var(--nim-text-faint)]'}`}>
                      Global: {globalEnabled ? 'On' : 'Off'}
                    </span>
                    {overriding && (
                      <span className="override-badge text-[11px] px-2 py-0.5 rounded font-medium bg-[var(--nim-accent-muted)] text-[var(--nim-primary)]">Overridden</span>
                    )}
                    <span className={`effective-status text-[11px] px-2.5 py-1 rounded-xl font-semibold ${effectiveEnabled ? 'bg-[#22c55e] text-white' : 'bg-[var(--nim-bg-tertiary)] text-[var(--nim-text-faint)]'}`}>
                      {effectiveEnabled ? 'Active' : 'Inactive'}
                    </span>
                    <span className={`expand-icon text-[var(--nim-text-faint)] transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`}>
                      <MaterialSymbol icon="expand_more" size={16} />
                    </span>
                  </div>
                </div>

                {/* Expanded Content */}
                {isExpanded && (
                  <div className="provider-card-content px-4 pb-4 border-t border-[var(--nim-border)] bg-[var(--nim-bg)]">
                    {/* Override Toggle */}
                    <div className="override-toggle-section py-4 border-b border-[var(--nim-border)]">
                      <label className="override-toggle flex items-center gap-3 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={overriding}
                          onChange={(e) => handleOverrideToggle(provider.id, e.target.checked)}
                          className="hidden"
                        />
                        <span className={`toggle-slider relative w-11 h-6 rounded-xl shrink-0 transition-colors duration-200 before:content-[''] before:absolute before:top-0.5 before:left-0.5 before:w-5 before:h-5 before:bg-white before:rounded-full before:transition-transform before:duration-200 before:shadow-[0_1px_3px_rgba(0,0,0,0.2)] ${overriding ? 'bg-[var(--nim-primary)] before:translate-x-5' : 'bg-[var(--nim-bg-tertiary)]'}`}></span>
                        <span className="toggle-label text-[13px] text-[var(--nim-text-muted)]">
                          {overriding ? 'Override enabled - using project settings' : 'Using global settings'}
                        </span>
                      </label>
                    </div>

                    {overriding && (
                      <>
                        {/* Enable Toggle */}
                        <div className="config-section py-4 border-b border-[var(--nim-border)]">
                          <div className="config-row flex items-center justify-between">
                            <span className="config-label text-[13px] text-[var(--nim-text)]">Enable for this project</span>
                            <label className="toggle-switch relative inline-block cursor-pointer">
                              <input
                                type="checkbox"
                                checked={override?.enabled ?? false}
                                onChange={(e) => handleEnabledChange(provider.id, e.target.checked)}
                                className="hidden"
                              />
                              <span className={`toggle-slider relative block w-9 h-5 rounded-xl transition-colors duration-200 before:content-[''] before:absolute before:top-0.5 before:left-0.5 before:w-4 before:h-4 before:bg-white before:rounded-full before:transition-transform before:duration-200 before:shadow-[0_1px_3px_rgba(0,0,0,0.2)] ${override?.enabled ? 'bg-[var(--nim-primary)] before:translate-x-4' : 'bg-[var(--nim-bg-tertiary)]'}`}></span>
                            </label>
                          </div>
                        </div>

                        {/* Credential profile picker */}
                        {provider.apiKeyField && (() => {
                          const providerProfiles = credentialProfiles.filter(p => p.providerId === provider.id);
                          const selectedProfileId = override?.credentialProfileId;
                          const hasLegacyKey = !!override?.apiKey && !selectedProfileId;
                          // "new" is a sentinel value for "show inline create form"
                          const dropdownValue = selectedProfileId
                            ? selectedProfileId
                            : (newKeyInput[provider.id] !== undefined ? '__new__' : '');
                          return (
                            <div className="config-section py-4 border-b border-[var(--nim-border)]">
                              <h4 className="config-section-title nim-section-label m-0 mb-3">Credential</h4>
                              <select
                                className="nim-input text-[13px] w-full"
                                value={dropdownValue}
                                onChange={(e) => {
                                  const v = e.target.value;
                                  if (v === '__new__') {
                                    setNewKeyInput(prev => ({ ...prev, [provider.id]: '' }));
                                    setNewKeyLabel(prev => ({ ...prev, [provider.id]: '' }));
                                    handleSelectProfile(provider.id, null);
                                  } else if (v === '') {
                                    setNewKeyInput(prev => {
                                      const { [provider.id]: _omit, ...rest } = prev;
                                      return rest;
                                    });
                                    handleSelectProfile(provider.id, null);
                                  } else {
                                    setNewKeyInput(prev => {
                                      const { [provider.id]: _omit, ...rest } = prev;
                                      return rest;
                                    });
                                    handleSelectProfile(provider.id, v);
                                  }
                                }}
                              >
                                <option value="">
                                  Use global default{globalApiKeys[provider.apiKeyField] ? '' : ' (no key configured)'}
                                </option>
                                {providerProfiles.map(p => (
                                  <option key={p.id} value={p.id}>{p.label}</option>
                                ))}
                                <option value="__new__">+ New profile…</option>
                              </select>

                              {hasLegacyKey && (
                                <div className="mt-3 flex items-center justify-between gap-2 px-3 py-2 rounded-md bg-[var(--nim-accent-subtle)] border border-[var(--nim-accent-subtle)] text-[13px]">
                                  <span className="text-[var(--nim-text)]">
                                    This project has a saved key from an older Nimbalyst version. Convert it into a credential profile?
                                  </span>
                                  <button
                                    className="nim-btn-secondary text-xs px-3 py-1.5 shrink-0"
                                    onClick={() => handleConvertLegacyKey(provider)}
                                  >
                                    Convert
                                  </button>
                                </div>
                              )}

                              {newKeyInput[provider.id] !== undefined && (
                                <div className="mt-3 flex flex-col gap-2 p-3 rounded-md bg-[var(--nim-bg)] border border-[var(--nim-primary)]">
                                  <div className="flex flex-col gap-1">
                                    <label className="text-xs text-[var(--nim-text-muted)]">Profile label</label>
                                    <input
                                      type="text"
                                      className="nim-input text-[13px]"
                                      placeholder={`${workspaceName} – ${provider.name}`}
                                      value={newKeyLabel[provider.id] ?? ''}
                                      onChange={(e) => setNewKeyLabel(prev => ({ ...prev, [provider.id]: e.target.value }))}
                                    />
                                  </div>
                                  <div className="flex flex-col gap-1">
                                    <label className="text-xs text-[var(--nim-text-muted)]">API key</label>
                                    <input
                                      type="password"
                                      className="nim-input font-mono text-[13px]"
                                      placeholder="sk-..."
                                      value={newKeyInput[provider.id] ?? ''}
                                      onChange={(e) => setNewKeyInput(prev => ({ ...prev, [provider.id]: e.target.value }))}
                                      autoFocus
                                    />
                                  </div>
                                  <div className="flex justify-end gap-2">
                                    <button
                                      className="nim-btn-secondary text-xs px-3 py-1.5"
                                      onClick={() => {
                                        setNewKeyInput(prev => {
                                          const { [provider.id]: _omit, ...rest } = prev;
                                          return rest;
                                        });
                                        setNewKeyLabel(prev => {
                                          const { [provider.id]: _omit, ...rest } = prev;
                                          return rest;
                                        });
                                      }}
                                    >
                                      Cancel
                                    </button>
                                    <button
                                      className="nim-btn-primary text-xs px-3 py-1.5"
                                      disabled={!newKeyInput[provider.id]?.trim()}
                                      onClick={() => handleCreateInlineProfile(provider)}
                                    >
                                      Save profile
                                    </button>
                                  </div>
                                </div>
                              )}
                            </div>
                          );
                        })()}

                        {/* Models Selection */}
                        {models.length > 0 && (
                          <div className="config-section py-4 border-b border-[var(--nim-border)] last:border-b-0">
                            <div className="config-section-header flex items-center justify-between mb-3">
                              <h4 className="config-section-title nim-section-label m-0">Models</h4>
                              <div className="models-actions flex gap-1.5">
                                <button
                                  className="models-action-btn px-2.5 py-1 text-[11px] font-medium text-[var(--nim-text-muted)] bg-[var(--nim-bg-tertiary)] border-none rounded cursor-pointer transition-all duration-150 hover:bg-[var(--nim-bg-hover)] hover:text-[var(--nim-text)]"
                                  onClick={() => handleSelectAllModels(provider.id, true)}
                                >
                                  All
                                </button>
                                <button
                                  className="models-action-btn px-2.5 py-1 text-[11px] font-medium text-[var(--nim-text-muted)] bg-[var(--nim-bg-tertiary)] border-none rounded cursor-pointer transition-all duration-150 hover:bg-[var(--nim-bg-hover)] hover:text-[var(--nim-text)]"
                                  onClick={() => handleSelectAllModels(provider.id, false)}
                                >
                                  None
                                </button>
                              </div>
                            </div>
                            <div className="models-grid grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-2">
                              {models.map(model => {
                                const isSelected = selectedModels.includes(model.id);
                                return (
                                  <label
                                    key={model.id}
                                    className={`model-item flex items-center gap-2 px-3 py-2.5 rounded-md cursor-pointer transition-all duration-150 border ${isSelected ? 'bg-[var(--nim-accent-subtle)] border-[var(--nim-primary)]' : 'bg-[var(--nim-bg-secondary)] border-[var(--nim-border)] hover:border-[var(--nim-border-secondary)]'}`}
                                  >
                                    <input
                                      type="checkbox"
                                      checked={isSelected}
                                      onChange={(e) => handleModelToggle(provider.id, model.id, e.target.checked)}
                                      className="accent-[var(--nim-primary)]"
                                    />
                                    <span className="model-name text-[13px] text-[var(--nim-text)]">{model.name || model.id}</span>
                                  </label>
                                );
                              })}
                            </div>
                          </div>
                        )}
                      </>
                    )}

                    {!overriding && (
                      <div className="no-override-message py-4 text-center">
                        <p className="m-0 text-[13px] text-[var(--nim-text-muted)]">This project uses global settings for {provider.name}.</p>
                        <p className="hint mt-1 text-xs text-[var(--nim-text-faint)]">Enable override to customize API key or models for this project.</p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {hasAnyOverrides() && (
          <div className="overrides-summary flex items-center gap-2 mt-4 px-4 py-3 rounded-lg text-[13px] bg-[var(--nim-accent-subtle)] border border-[var(--nim-accent-subtle)] text-[var(--nim-primary)]">
            <MaterialSymbol icon="info" size={16} className="shrink-0" />
            <span>This project has custom AI provider settings</span>
          </div>
        )}
      </div>

      {/* Tracker Automation Override */}
      <div className="tracker-automation-override mt-6 pt-4 border-t border-[var(--nim-border)]">
        <h3 className="text-sm font-semibold text-[var(--nim-text)] mb-3">Tracker Automation</h3>
        <div className="flex items-center gap-3 mb-2">
          <select
            className="text-sm rounded border border-[var(--nim-border)] bg-[var(--nim-bg-secondary)] text-[var(--nim-text)] px-3 py-1.5"
            value={trackerAutomationOverride === null ? 'inherit' : trackerAutomationOverride?.enabled ? 'enable' : 'disable'}
            onChange={(e) => {
              const val = e.target.value;
              if (val === 'inherit') {
                setTrackerAutomationOverride(null);
              } else {
                setTrackerAutomationOverride({ enabled: val === 'enable' });
              }
              setHasChanges(true);
            }}
          >
            <option value="inherit">Inherit from global settings</option>
            <option value="enable">Enable for this project</option>
            <option value="disable">Disable for this project</option>
          </select>
        </div>
        <p className="text-xs text-[var(--nim-text-faint)] m-0">
          Override the global tracker automation setting for this workspace.
        </p>
      </div>

      <div className="panel-footer flex justify-end pt-4 border-t border-[var(--nim-border)]">
        <button
          className="save-button nim-btn-primary px-6 py-2.5 text-[13px]"
          onClick={handleSave}
          disabled={!hasChanges || saving}
        >
          {saving ? 'Saving...' : hasChanges ? 'Save Changes' : 'Saved'}
        </button>
      </div>
    </div>
  );
}
