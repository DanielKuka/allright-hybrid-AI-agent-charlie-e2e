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

export interface BackendEvidence {
  trialBalanceFound: boolean;
  lessonsScheduled: number;
  lessonRecords: number;
}

export interface FlowResult {
  outcome: FunnelOutcome;
  reason: string;
  terminalUrl: string;
  userId?: string;
  whoUserIs?: string;
  backend?: BackendEvidence;
}
