import webpush from "web-push";
import { describe, expect, it } from "vitest";
import { authConfigFor, connectionOptions, generateVapidKeys, migrationFiles } from "./setup.mjs";

describe("deploy setup", () => {
  it("lists migrations in order with their versions", () => {
    const files = migrationFiles();
    expect(files[0]).toMatchObject({ version: "20261006000001", name: "schema" });
    expect(files.map((f: { file: string }) => f.file)).toEqual([...files.map((f: { file: string }) => f.file)].sort());
  });

  it("drops non-Postgres URL parameters and requires SSL off-machine", () => {
    const pooled = connectionOptions("postgres://u:p@aws-0.pooler.supabase.com:6543/postgres?sslmode=require&supa=base-pooler.x");
    expect(pooled.url).toBe("postgres://u:p@aws-0.pooler.supabase.com:6543/postgres");
    expect(pooled.options).toMatchObject({ ssl: "require", prepare: false });
    expect(connectionOptions("postgres://u@localhost:5432/db").options.ssl).toBe(false);
  });

  it("points auth at the deployment and keeps existing redirect URLs", () => {
    const body = authConfigFor("https://het.vercel.app", "https://old.example/**, http://localhost:3000/**");
    expect(body.site_url).toBe("https://het.vercel.app");
    expect(body.uri_allow_list.split(",")).toEqual(["https://old.example/**", "http://localhost:3000/**", "https://het.vercel.app/**"]);
    expect(body.mailer_templates_magic_link_content).toContain("{{ .Token }}");
    expect(body.mailer_templates_confirmation_content).toContain("{{ .Token }}");
  });

  it("generates push keys web-push accepts", () => {
    const keys = generateVapidKeys();
    expect(Buffer.from(keys.publicKey, "base64url")).toHaveLength(65);
    expect(Buffer.from(keys.privateKey, "base64url")).toHaveLength(32);
    const headers = webpush.getVapidHeaders("https://web.push.apple.com", "https://het.vercel.app", keys.publicKey, keys.privateKey, "aes128gcm");
    expect(headers.Authorization).toMatch(/^vapid t=.+, k=/);
    expect(generateVapidKeys().privateKey).not.toBe(keys.privateKey);
  });
});
