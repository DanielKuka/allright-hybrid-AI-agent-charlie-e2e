export type AgentAction =
  | { type: 'click'; selector: string; reason: string }
  | { type: 'fill'; selector: string; value: string; reason: string }
  | { type: 'select'; selector: string; value: string; reason: string }
  | { type: 'dismiss'; selector: string; reason: string }
  | { type: 'done'; reason: string }
  | { type: 'stuck'; reason: string };

export interface TestIdentity {
  runId: string;
  phone: string;
  phoneMasked: string;
  email: string;
  parentName: string;
  childName: string;
}

export interface StepLog {
  step: number;
  action: AgentAction;
  timestamp: string;
}

export type NavigatorOutcome =
  | { status: 'done'; reason: string }
  | { status: 'stuck'; reason: string }
  | { status: 'timeout'; reason: string };

export enum FunnelOutcome {
  BOOKED = 'BOOKED',
  LEAD_CREATED = 'LEAD_CREATED',
  FAILED = 'FAILED'
}

export enum LessonEvidence {
  ACTIVE = 'ACTIVE',
  INACTIVE = 'INACTIVE',
  INDETERMINATE = 'INDETERMINATE'
}

export interface BackendEvidence {
  trialBalanceFound: boolean;
  lessonsScheduled: number;
  lessonRecords: number;
  lessonEvidence: LessonEvidence;
}

export interface FlowResult {
  outcome: FunnelOutcome;
  reason: string;
  terminalUrl: string;
  userId?: string;
  whoUserIs?: string;
  backend?: BackendEvidence;
}

export type CleanupEvidence =
  | { status: 'DELETED'; httpStatus: number }
  | { status: 'NOT_REQUIRED' }
  | { status: 'FAILED'; reason: string };

export interface ExperimentContext {
  httpAssignment: unknown;
  storageAssignment: unknown;
}

export interface LifecycleVerdict {
  businessPassed: boolean;
  cleanupPassed: boolean;
  failures: string[];
}
