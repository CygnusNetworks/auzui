/**
 * event.acknowledge `action` bitmask (Zabbix API): 1 close, 2 acknowledge,
 * 4 add message, 8 change severity, 16 unacknowledge, 32 suppress,
 * 64 unsuppress. All bits are combinable in a single call (e.g. ack +
 * message, or suppress + message).
 */
export const ACK_ACTION = {
  CLOSE: 1,
  ACKNOWLEDGE: 2,
  MESSAGE: 4,
  CHANGE_SEVERITY: 8,
  UNACKNOWLEDGE: 16,
  SUPPRESS: 32,
  UNSUPPRESS: 64,
} as const;

export interface AckActionInput {
  ack?: boolean;
  unack?: boolean;
  message?: string;
  suppress?: boolean;
  unsuppress?: boolean;
  /** Presence of a value (including 0) requests a severity change. */
  severity?: number;
}

/**
 * Builds the action bitmask for event.acknowledge. Ack/un-ack and
 * suppress/unsuppress are each mutually exclusive in the Zabbix API (a
 * request must not set both bits of a pair); the "positive" action wins if
 * both are somehow requested.
 */
export function buildAckAction(input: AckActionInput): number {
  let action = 0;
  if (input.ack) {
    action |= ACK_ACTION.ACKNOWLEDGE;
  } else if (input.unack) {
    action |= ACK_ACTION.UNACKNOWLEDGE;
  }
  if (input.message && input.message.trim().length > 0) {
    action |= ACK_ACTION.MESSAGE;
  }
  if (input.severity !== undefined) {
    action |= ACK_ACTION.CHANGE_SEVERITY;
  }
  if (input.suppress) {
    action |= ACK_ACTION.SUPPRESS;
  } else if (input.unsuppress) {
    action |= ACK_ACTION.UNSUPPRESS;
  }
  return action;
}
