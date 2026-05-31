/**
 * Automation frontmatter types.
 *
 * Automations are markdown files with YAML frontmatter containing
 * an `automationStatus` block that defines scheduling and output config.
 */

export type DayOfWeek = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';

export const ALL_DAYS: DayOfWeek[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
export const WEEKDAYS: DayOfWeek[] = ['mon', 'tue', 'wed', 'thu', 'fri'];

export const DAY_LABELS: Record<DayOfWeek, string> = {
  mon: 'M',
  tue: 'T',
  wed: 'W',
  thu: 'T',
  fri: 'F',
  sat: 'S',
  sun: 'S',
};

export const DAY_FULL_LABELS: Record<DayOfWeek, string> = {
  mon: 'Monday',
  tue: 'Tuesday',
  wed: 'Wednesday',
  thu: 'Thursday',
  fri: 'Friday',
  sat: 'Saturday',
  sun: 'Sunday',
};

export type ScheduleType = 'interval' | 'daily' | 'weekly';

export interface IntervalSchedule {
  type: 'interval';
  intervalMinutes: number;
}

export interface DailySchedule {
  type: 'daily';
  time: string; // "HH:MM" 24h format
}

export interface WeeklySchedule {
  type: 'weekly';
  days: DayOfWeek[];
  time: string; // "HH:MM" 24h format
}

export type AutomationSchedule = IntervalSchedule | DailySchedule | WeeklySchedule;

export type OutputMode = 'new-file' | 'append' | 'replace';

export interface AutomationOutput {
  mode: OutputMode;
  /** Relative path from workspace root to output directory or file */
  location: string;
  /** Template for new-file mode. Supports {{date}}, {{time}}, {{id}} */
  fileNameTemplate?: string;
}

/**
 * Optional pre-check step. Runs before the agent on each tick.
 *
 * Exit code controls escalation:
 *   - 0                  -> escalate to the agent; stdout becomes the payload
 *   - `skipExitCode`     -> skip this tick cleanly (no agent invocation, no
 *                           output file written; recorded as `skipped` in history)
 *   - any other non-zero -> treat as an error; recorded as `error` in history
 *                          with stderr captured
 *
 * Stdout handling on escalate: if the script emits a JSON object on stdout
 * with shape `{ "escalate": boolean, "payload": "..." }`, those fields are
 * respected. Otherwise the raw stdout becomes the payload verbatim. If the
 * prompt body contains `{{script_output}}`, the payload is substituted there;
 * otherwise it is appended to the prompt under a `## Script Output` heading.
 *
 * Env vars injected into the script:
 *   - NIMBALYST_AUTOMATION_ID
 *   - NIMBALYST_WORKSPACE
 *   - NIMBALYST_LAST_RUN  (ISO timestamp, empty on first run)
 */
export interface AutomationPrecheck {
  /** Path to the script (resolved relative to workspace root). */
  script: string;
  /** Arguments passed to the script. */
  args?: string[];
  /** Hard timeout in seconds. Default 30. */
  timeoutSeconds?: number;
  /** Exit code that means "skip this tick". Default 99. */
  skipExitCode?: number;
}

export interface AutomationStatus {
  id: string;
  title: string;
  enabled: boolean;
  schedule: AutomationSchedule;
  output: AutomationOutput;
  /** Optional pre-check script that gates whether the agent is invoked. */
  precheck?: AutomationPrecheck;
  provider?: 'claude-code' | 'claude' | 'openai';
  /** Model ID to use (e.g. 'claude-code:opus', 'claude-code:sonnet', 'claude:claude-sonnet-4-5-20241022') */
  model?: string;
  lastRun?: string;
  lastRunStatus?: 'success' | 'error' | 'skipped';
  lastRunError?: string;
  /** When the last run was skipped by the precheck, why. */
  lastSkipReason?: string;
  nextRun?: string;
  runCount: number;
  /** Number of ticks where the precheck skipped without invoking the agent. */
  skipCount?: number;
}

/**
 * A single execution record stored in history.json.
 *
 * `status: 'skipped'` means the precheck script intentionally declined to
 * invoke the agent (no output file is written). `status: 'error'` covers
 * both agent failures and precheck failures (timeout or unexpected exit
 * code).
 */
export interface ExecutionRecord {
  id: string;
  timestamp: string;
  durationMs: number;
  status: 'success' | 'error' | 'skipped';
  error?: string;
  /** Reason supplied when status is 'skipped' (e.g. exit code, "no-changes"). */
  skipReason?: string;
  sessionId?: string;
  outputFile?: string;
}

/**
 * Default values for a new automation.
 */
export function createDefaultAutomationStatus(
  id: string = 'new-automation',
  title: string = 'New Automation',
): AutomationStatus {
  return {
    id,
    title,
    enabled: false,
    schedule: {
      type: 'daily',
      time: '09:00',
    },
    output: {
      mode: 'new-file',
      location: `nimbalyst-local/automations/${id}/`,
      fileNameTemplate: '{{date}}-output.md',
    },
    runCount: 0,
  };
}
