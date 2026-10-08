import { describe, expect, it, vi } from "vitest";

const sendNotification = vi.fn(async () => ({ statusCode: 201 }));
vi.mock("web-push", () => ({ default: { sendNotification } }));
vi.mock("next/server", () => ({ after: () => {} }));

describe("sendPush", () => {
  it("asks for high urgency, so Android shows it even when the phone is idle", async () => {
    const { sendPush } = await import("./push");
    const res = await sendPush(
      {} as never,
      { subject: "https://example.com", publicKey: "pub", privateKey: "priv" },
      [{ endpoint: "https://fcm.googleapis.com/fcm/send/x", p256dh: "k", auth: "a" }],
      { title: "t", body: "b", url: "/budgets", tag: "x" },
    );
    expect(res).toEqual({ sent: 1, errors: [] });
    expect(sendNotification).toHaveBeenCalledWith(expect.anything(), expect.any(String), expect.objectContaining({ urgency: "high" }));
  });
});
