import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { Item, ItemSummary, JobRow, Device, FleetState, Schedule } from "@socheli/sdk";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
export const DATA_DIR = process.env.SOCHELI_DATA_DIR || join(ROOT, "data");
const RUNS = join(DATA_DIR, "runs");
const RENDERS = process.env.SOCHELI_RENDERS_DIR || join(DATA_DIR, "renders");
const MEDIA_BASE = (process.env.HOST_PUBLIC_BASE || "https://media.socheli.com").replace(/\/$/, "");

function readJson<T>(p: string, d: T): T {
  if (!existsSync(p)) return d;
  try {
    return JSON.parse(readFileSync(p, "utf8")) as T;
  } catch {
    return d;
  }
}

function rawItems(): any[] {
  if (!existsSync(RUNS)) return [];
  return readdirSync(RUNS)
    .filter((f) => f.endsWith(".json"))
    .map((f) => readJson<any>(join(RUNS, f), null))
    .filter(Boolean)
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

const title = (it: any): string => it.pkg?.title ?? it.idea?.topic ?? it.seedIdea ?? it.id;
const videoUrl = (it: any): string | undefined =>
  it.videoPath || existsSync(join(RENDERS, `${it.id}.mp4`)) ? `${MEDIA_BASE}/${it.id}.mp4` : undefined;

export function toSummary(it: any): ItemSummary {
  return {
    id: it.id,
    channel: it.channel,
    status: it.status,
    title: title(it),
    createdAt: it.createdAt,
    updatedAt: it.updatedAt,
    qa: it.qa?.overall,
    costUsd: it.ledger?.totalUsd,
    publish: it.publish,
  };
}

export function toItem(it: any): Item {
  return {
    ...toSummary(it),
    idea: it.idea && { topic: it.idea.topic, angle: it.idea.angle, format: it.idea.format },
    script: it.script && { hook: it.script.hook, narration: it.script.narration, cta: it.script.cta },
    storyboard: it.storyboard && {
      topic: it.storyboard.topic,
      format: it.storyboard.format,
      scenes: (it.storyboard.scenes ?? []).map((s: any) => ({ id: s.id, type: s.type, durationSec: s.durationSec })),
    },
    pkg: it.pkg && { title: it.pkg.title, caption: it.pkg.caption, hashtags: it.pkg.hashtags, altText: it.pkg.altText },
    videoUrl: videoUrl(it),
  };
}

export function listItems(opts: { limit?: number; channel?: string } = {}): ItemSummary[] {
  let xs = rawItems();
  if (opts.channel) xs = xs.filter((x) => x.channel === opts.channel);
  if (opts.limit) xs = xs.slice(0, opts.limit);
  return xs.map(toSummary);
}

export function getItem(id: string): Item | null {
  const p = join(RUNS, `${id}.json`);
  const raw = readJson<any>(p, null);
  return raw ? toItem(raw) : null;
}

export function getJobs(): JobRow[] {
  return readJson<{ jobs: JobRow[] }>(join(DATA_DIR, "jobs.json"), { jobs: [] }).jobs ?? [];
}

const STALE_MS = 70_000;
export function getFleet(): FleetState {
  const f = readJson<{ devices: Record<string, Device> }>(join(DATA_DIR, "fleet.json"), { devices: {} });
  const now = Date.now();
  const devices = Object.values(f.devices).map((d) => {
    const stale = now - new Date(d.lastSeen).getTime() > STALE_MS;
    return stale && d.status !== "offline" ? { ...d, status: "offline" as const } : d;
  });
  return { devices, jobs: getJobs().slice(0, 30), online: devices.filter((d) => d.status !== "offline").length };
}

export function getSchedule(): Schedule {
  return readJson<Schedule>(join(DATA_DIR, "schedule.json"), { enabled: false, timezone: "UTC", graceMinutes: 10, channels: [] });
}
