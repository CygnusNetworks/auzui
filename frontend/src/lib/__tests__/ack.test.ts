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
});
