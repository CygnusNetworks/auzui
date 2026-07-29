/**
 * event.acknowledge `action` bitmask (Zabbix API): 1 close, 2 acknowledge,
 * 4 add message, 8 change severity, 16 unacknowledge. PLAN.md scope only
 * needs ack / un-ack / comment, combinable (e.g. ack + message in one call).
 */
export const ACK_ACTION = {
  CLOSE: 1,
  ACKNOWLEDGE: 2,
  MESSAGE: 4,
  CHANGE_SEVERITY: 8,
  UNACKNOWLEDGE: 16,
} as const;

export interface AckActionInput {
  ack?: boolean;
  unack?: boolean;
  message?: string;
}

/**
 * Builds the action bitmask for event.acknowledge. Ack and Un-ack are
 * mutually exclusive in the Zabbix API (a request must not set both bits);
 * ack wins if both are somehow requested.
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
  return action;
}
