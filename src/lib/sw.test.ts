// Runs public/sw.js's push handler against a fake service worker scope.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

function loadWorker(showNotification: (title: string, options: object) => Promise<void>) {
  const handlers: Record<string, (e: unknown) => void> = {};
  const posted: unknown[] = [];
  const self = {
    addEventListener: (type: string, fn: (e: unknown) => void) => (handlers[type] = fn),
    registration: { showNotification: vi.fn(showNotification), getNotifications: async () => [{}] },
    clients: { matchAll: async () => [{ postMessage: (m: unknown) => posted.push(m) }] },
    location: { origin: "https://app.example" },
  };
  new Function("self", "caches", "Notification", readFileSync(join(__dirname, "../../public/sw.js"), "utf8"))(self, {}, { permission: "granted" });
  async function push(payload: object) {
    let done: Promise<unknown> = Promise.resolve();
    handlers.push({ data: { json: () => payload, text: () => JSON.stringify(payload) }, waitUntil: (p: Promise<unknown>) => (done = p) });
    await done;
  }
  return { self, posted, push };
}

describe("service worker push", () => {
  it("shows the alert, re-alerting when it replaces one with the same tag, and reports back", async () => {
    const w = loadWorker(async () => {});
    await w.push({ title: "Eating out: 82% of budget", body: "$72 left", url: "/budgets", tag: "budget-1" });
    expect(w.self.registration.showNotification).toHaveBeenCalledWith(
      "Eating out: 82% of budget",
      expect.objectContaining({ body: "$72 left", tag: "budget-1", renotify: true }),
    );
    expect(w.posted).toEqual([{ type: "push-received", tag: "budget-1", result: "shown", showing: 1, permission: "granted" }]);
  });

  it("never sets renotify without a tag (that throws)", async () => {
    const w = loadWorker(async () => {});
    await w.push({ title: "t", body: "b" });
    expect(w.self.registration.showNotification.mock.calls[0][1]).not.toHaveProperty("renotify");
  });

  it("falls back to a plain notification and says why", async () => {
    let first = true;
    const w = loadWorker(async () => {
      if (first) {
        first = false;
        throw new Error("icon failed");
      }
    });
    await w.push({ title: "t", body: "b", tag: "x" });
    expect(w.self.registration.showNotification).toHaveBeenCalledTimes(2);
    expect(w.posted[0]).toMatchObject({ result: "shown without icon (icon failed)" });
  });
});
