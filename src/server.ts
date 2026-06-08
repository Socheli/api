#!/usr/bin/env -S node --import tsx
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import mqtt from "mqtt";
import { listItems, getItem, getJobs, getFleet, getSchedule, DATA_DIR } from "./store.ts";
import { jobRequirements, pickDevice } from "./match.ts";

/* Socheli API — the control-plane backbone. The SDK, CLI, MCP server, and any
   third-party integration talk to this. Auth is a static API key (Bearer);
   reads come from the file store, writes dispatch over MQTT or spawn the engine. */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const PORT = Number(process.env.SOCHELI_API_PORT || 8787);
const API_KEY = process.env.SOCHELI_API_KEY || "";
const VERSION = "0.1.0";
const startedAt = Date.now();

const app = new Hono();
app.use("*", cors());

// ── auth ─────────────────────────────────────────────────────────────────────
app.use("/v1/*", async (c, next) => {
  if (c.req.path === "/v1/health") return next();
  const auth = c.req.header("Authorization") || "";
  const key = auth.replace(/^Bearer\s+/i, "");
  if (!API_KEY) return c.json({ error: "API not configured (no SOCHELI_API_KEY)" }, 503);
  if (key !== API_KEY) return c.json({ error: "unauthorized" }, 401);
  return next();
});

// ── reads ────────────────────────────────────────────────────────────────────
app.get("/v1/health", (c) => c.json({ ok: true, version: VERSION, uptime: Math.round((Date.now() - startedAt) / 1000) }));

app.get("/v1/items", (c) => {
  const limit = c.req.query("limit") ? Number(c.req.query("limit")) : undefined;
  const channel = c.req.query("channel") || undefined;
  return c.json(listItems({ limit, channel }));
});

app.get("/v1/items/:id", (c) => {
  const it = getItem(c.req.param("id"));
  return it ? c.json(it) : c.json({ error: "not found" }, 404);
});

app.get("/v1/jobs", (c) => c.json(getJobs().slice(0, 30)));
app.get("/v1/fleet", (c) => c.json(getFleet()));
app.get("/v1/schedule", (c) => c.json(getSchedule()));

// ── writes ───────────────────────────────────────────────────────────────────
async function dispatch(topic: string, job: Record<string, unknown>): Promise<void> {
  const c = await mqtt.connectAsync(process.env.SOCHELI_BROKER_URL || "mqtt://127.0.0.1:1883", {
    username: process.env.SOCHELI_MQTT_USER,
    password: process.env.SOCHELI_MQTT_PASS,
    connectTimeout: 8000,
  });
  await c.publishAsync(topic, JSON.stringify(job), { qos: 1 });
  await c.endAsync();
}

app.post("/v1/generate", async (c) => {
  const b = await c.req.json().catch(() => ({}));
  if (!b.seed) return c.json({ error: "seed required" }, 400);
  const job = {
    id: `job_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`,
    type: b.type === "auto" ? "auto" : "new",
    channel: String(b.channel ?? "concept_lab"),
    seed: String(b.seed),
    mood: b.mood ? String(b.mood) : undefined,
    voice: b.voice === true,
    createdAt: new Date().toISOString(),
    by: "api",
  };

  // central scheduler: route to the best-fit device by capability
  const reqs = jobRequirements(job);
  const match = pickDevice(getFleet().devices, reqs);
  if (!match.device) return c.json({ error: match.reason, requirements: reqs }, 503);

  try {
    await dispatch(`socheli/device/${match.device.device}/jobs`, job);
  } catch (e: any) {
    return c.json({ error: `broker unreachable: ${e?.message ?? e}` }, 502);
  }
  return c.json({ dispatched: true, job, device: match.device.device, routing: match.reason });
});

app.post("/v1/items/:id/publish", async (c) => {
  const id = c.req.param("id");
  const b = await c.req.json().catch(() => ({}));
  const args = ["--import", "tsx", join(ROOT, "packages", "engine", "src", "cli.ts"), "publish", id];
  if (b.public === true) args.push("--public");
  if (b.aigc === false) args.push("--no-aigc");
  const child = spawn("node", args, { cwd: ROOT, detached: true, stdio: "ignore", env: process.env });
  child.unref();
  return c.json({ dispatched: true });
});

app.put("/v1/schedule", async (c) => {
  const s = await c.req.json().catch(() => null);
  if (!s || typeof s !== "object") return c.json({ error: "bad schedule" }, 400);
  s.updatedAt = new Date().toISOString();
  writeFileSync(join(DATA_DIR, "schedule.json"), JSON.stringify(s, null, 2));
  return c.json(s);
});

app.notFound((c) => c.json({ error: "not found" }, 404));

serve({ fetch: app.fetch, port: PORT }, (info) => {
  console.log(`[socheli-api ${VERSION}] listening on :${info.port}${API_KEY ? "" : "  (WARNING: no SOCHELI_API_KEY set)"}`);
});
