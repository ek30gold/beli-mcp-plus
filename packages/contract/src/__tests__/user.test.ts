import { describe, expect, it } from "vitest";
import { LoginRequest } from "@beli/contract";

describe("LoginRequest (email-or-phone union)", () => {
  it("accepts an email + password body", () => {
    const parsed = LoginRequest.parse({ email: "a@example.com", password: "hunter2" });
    expect(parsed).toEqual({ email: "a@example.com", password: "hunter2" });
  });

  it("accepts a phone_no + password body", () => {
    const parsed = LoginRequest.parse({ phone_no: "+15551234567", password: "hunter2" });
    expect(parsed).toEqual({ phone_no: "+15551234567", password: "hunter2" });
  });

  it("rejects a body with BOTH email and phone_no as a clean validation error", () => {
    const result = LoginRequest.safeParse({
      email: "a@example.com",
      phone_no: "+15551234567",
      password: "hunter2",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a body with NEITHER email nor phone_no as a clean validation error", () => {
    const result = LoginRequest.safeParse({ password: "hunter2" });
    expect(result.success).toBe(false);
  });

  it("rejects a malformed email without throwing an unhandled exception", () => {
    expect(() =>
      LoginRequest.parse({ email: "not-an-email", password: "hunter2" }),
    ).not.toThrow(TypeError); // fails validation cleanly, not a crash
    const result = LoginRequest.safeParse({ email: "not-an-email", password: "hunter2" });
    expect(result.success).toBe(false);
  });

  it("rejects a malformed phone number", () => {
    const result = LoginRequest.safeParse({ phone_no: "555-1234", password: "hunter2" });
    expect(result.success).toBe(false);
  });

  it("rejects an empty password", () => {
    const result = LoginRequest.safeParse({ email: "a@example.com", password: "" });
    expect(result.success).toBe(false);
  });
});
