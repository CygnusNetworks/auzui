import { describe, expect, it } from "vitest";
import { ACK_ACTION, buildAckAction } from "../ack";

describe("buildAckAction", () => {
  it("returns 2 for a plain acknowledge", () => {
    expect(buildAckAction({ ack: true })).toBe(ACK_ACTION.ACKNOWLEDGE);
  });

  it("returns 16 for a plain un-ack", () => {
    expect(buildAckAction({ unack: true })).toBe(ACK_ACTION.UNACKNOWLEDGE);
  });

  it("combines acknowledge with a message (2 | 4 = 6)", () => {
    expect(buildAckAction({ ack: true, message: "looking into it" })).toBe(6);
  });

  it("combines un-ack with a message (16 | 4 = 20)", () => {
    expect(buildAckAction({ unack: true, message: "reopened" })).toBe(20);
  });

  it("returns 4 for a message-only comment", () => {
    expect(buildAckAction({ message: "just a note" })).toBe(ACK_ACTION.MESSAGE);
  });

  it("ignores a blank message", () => {
    expect(buildAckAction({ ack: true, message: "   " })).toBe(ACK_ACTION.ACKNOWLEDGE);
  });

  it("prefers ack over unack if both are set", () => {
    expect(buildAckAction({ ack: true, unack: true })).toBe(ACK_ACTION.ACKNOWLEDGE);
  });

  it("returns 0 for no input", () => {
    expect(buildAckAction({})).toBe(0);
  });

  it("returns 32 for suppress", () => {
    expect(buildAckAction({ suppress: true })).toBe(ACK_ACTION.SUPPRESS);
  });

  it("returns 64 for unsuppress", () => {
    expect(buildAckAction({ unsuppress: true })).toBe(ACK_ACTION.UNSUPPRESS);
  });

  it("prefers suppress over unsuppress if both are set", () => {
    expect(buildAckAction({ suppress: true, unsuppress: true })).toBe(ACK_ACTION.SUPPRESS);
  });

  it("returns 8 for a severity change", () => {
    expect(buildAckAction({ severity: 3 })).toBe(ACK_ACTION.CHANGE_SEVERITY);
  });

  it("treats severity 0 as a requested change (not absent)", () => {
    expect(buildAckAction({ severity: 0 })).toBe(ACK_ACTION.CHANGE_SEVERITY);
  });

  it("combines ack + suppress + message + severity change (2 | 32 | 4 | 8 = 46)", () => {
    expect(
      buildAckAction({ ack: true, suppress: true, message: "escalated", severity: 4 }),
    ).toBe(46);
  });

  it("combines unack + unsuppress (16 | 64 = 80)", () => {
    expect(buildAckAction({ unack: true, unsuppress: true })).toBe(80);
  });

  it("returns 1 for a manual close", () => {
    expect(buildAckAction({ close: true })).toBe(ACK_ACTION.CLOSE);
  });

  it("combines close with a message (1 | 4 = 5)", () => {
    expect(buildAckAction({ close: true, message: "fixed by reboot" })).toBe(5);
  });

  it("combines close + ack + message (1 | 2 | 4 = 7)", () => {
    expect(buildAckAction({ close: true, ack: true, message: "done" })).toBe(7);
  });
});
