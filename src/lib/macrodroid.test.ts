import { describe, expect, it } from "vitest";
import { CAPTURE_APPS, MACRODROID_BODY, buildMacro } from "./macrodroid";
import { parseNotification, readIngestBody } from "./notifications";

describe("MacroDroid macro file", () => {
  const file = buildMacro({ url: "https://our-spending.vercel.app/api/ingest", token: "het_abc", now: 1 });
  const [trigger] = file.macro.m_triggerList;
  const [request] = file.macro.m_actionList;

  it("is a MacroDroid export (version 1) with one enabled macro", () => {
    expect(file.macroExportVersion).toBe(1);
    expect(file.macro).toMatchObject({ m_enabled: true, m_completed: true, isActionBlock: false });
  });

  it("triggers on payment notifications from Wallet and the bank apps", () => {
    expect(trigger.m_classType).toBe("NotificationTrigger");
    expect(trigger.m_packageNameList).toEqual(CAPTURE_APPS.map(([, pkg]) => pkg));
    expect(trigger.m_packageNameList).toContain("com.google.android.apps.walletnfcrel");
    expect(trigger.m_applicationNameList).toHaveLength(trigger.m_packageNameList.length);
  });

  it("POSTs the notification to this app with this phone's token", () => {
    expect(request.m_classType).toBe("HttpRequestAction");
    expect(request.requestConfig).toMatchObject({
      requestType: 1,
      urlToOpen: "https://our-spending.vercel.app/api/ingest",
      contentBodyText: MACRODROID_BODY,
      contentType: "application/json",
    });
    expect(request.requestConfig.headerParams).toContainEqual({ paramName: "Authorization", paramValue: "Bearer het_abc" });
  });

  it("sends a body the server reads, once MacroDroid fills in the magic text", () => {
    const sent = MACRODROID_BODY.replace("{not_title}", "Woolworths").replace("{notification}", "$23.50 with Visa ••1234").replace("{not_app_name}", "Google Wallet");
    const body = readIngestBody(sent, "application/json")!;
    expect(body).toMatchObject({ source: "android", app: "Google Wallet" });
    expect(parseNotification(String(body.raw), String(body.app))).toMatchObject({ kind: "purchase", cents: 2350, merchant: "Woolworths" });
  });
});
