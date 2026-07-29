import { ZabbixApiError, ZabbixTransportError } from "@auzui/zabbix-client";

/**
 * Recognizes "your session is gone, log in again" from either transport
 * (HTTP 401, behind a reverse proxy) or the Zabbix API's own JSON-RPC error
 * (invalid/expired session token — Zabbix reports this as -32602 with a
 * "re-login" hint in `data`, there is no dedicated error code for it).
 */
export function isSessionError(error: unknown): boolean {
  if (error instanceof ZabbixTransportError) {
    return error.status === 401 || error.status === 403;
  }
  if (error instanceof ZabbixApiError) {
    const haystack = `${error.message} ${error.data ?? ""}`.toLowerCase();
    return (
      haystack.includes("re-login") ||
      haystack.includes("session terminated") ||
      haystack.includes("not authoris") ||
      haystack.includes("not authoriz")
    );
  }
  return false;
}
