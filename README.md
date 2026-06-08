> Note: the task's "Authoritative research for api" field was delivered empty (`{}`). Rather than invent details, every API fact below is sourced directly from the Socheli monorepo — `packages/api/src/server.ts`, `packages/api/src/match.ts`, `packages/api/package.json`, `packages/sdk/src/index.ts`, and `docs/api.md`. No endpoints, fields, env vars, or auth semantics have been invented.

---

# @socheli/api

**The REST control-plane backbone for Socheli — a Hono API at `api.socheli.com` that dispatches render jobs across a fleet over MQTT.**

[![npm](https://img.shields.io/npm/v/@socheli/api?color=000&label=%40socheli%2Fapi)](https://www.npmjs.com/package/@socheli/api)
[![License: MIT](https://img.shields.io/badge/license-MIT-000.svg)](./LICENSE)
[![Runtime: Hono](https://img.shields.io/badge/runtime-Hono%204-000)](https://hono.dev)
[![Node](https://img.shields.io/badge/node-%E2%89%A518-000)](https://nodejs.org)
[![API](https://img.shields.io/badge/api.socheli.com-online-000)](https://api.socheli.com)

---

## What it is

`@socheli/api` is the HTTP control plane for the [Socheli](https://socheli.com) content engine. Every first-party client — the [SDK](https://github.com/Socheli/sdk), the [CLI](https://github.com/Socheli/cli), the [MCP server](https://github.com/Socheli/mcp) — and any third-party integration talks to this service.

It is a small, fast [Hono](https://hono.dev) server (`@hono/node-server`) that does two things:

- **Reads** come straight from the file store (`items`, `jobs`, `fleet`, `schedule`).
- **Writes** either dispatch a job to a render device over **MQTT** or spawn the engine directly.

Generation requests are routed by a **capability-aware central scheduler**: each job's requirements are derived, then the best-fit online device in the live fleet is selected (preferring an `idle` device, with more RAM as a tie-breaker).

Auth is a single static API key, passed as a Bearer token.

---

## Install

```bash
npm install @socheli/api
# or
pnpm add @socheli/api
```

The package exposes a `socheli-api` binary and a `start` script.

```jsonc
// package.json (excerpt)
{
  "name": "@socheli/api",
  "version": "0.1.0",
  "bin": { "socheli-api": "src/server.ts" },
  "scripts": { "start": "node --import tsx src/server.ts" }
}
```

Run it:

```bash
SOCHELI_API_KEY=sk_your_key npm start
# [socheli-api 0.1.0] listening on :8787
```

> If `SOCHELI_API_KEY` is unset, the server still boots but logs a warning and answers `503 API not configured (no SOCHELI_API_KEY)` on every authenticated route.

### Hosted

The managed instance lives at **`https://api.socheli.com`** (version prefix `/v1`). You don't need to self-host to use it — point a client at the base URL with your key.

---

## Authentication

A **single Socheli API key**, sent as a Bearer token. Every endpoint **except `GET /v1/health`** requires it.

```
Authorization: Bearer <SOCHELI_API_KEY>
```

| Failure | Status | Body |
| --- | --- | --- |
| Wrong / missing key | `401` | `{ "error": "unauthorized" }` |
| Server has no key configured | `503` | `{ "error": "API not configured (no SOCHELI_API_KEY)" }` |

Clients (SDK/CLI/MCP) read the key from the **`SOCHELI_API_KEY`** environment variable. On a self-hosted deployment, set it in the server's environment (e.g. an `.env` file or your process manager). For the managed service, provision a key from your Socheli dashboard.

---

## Quickstart

```bash
# Health (no auth required)
curl -s https://api.socheli.com/v1/health

# Inspect the fleet
curl -s https://api.socheli.com/v1/fleet \
  -H "Authorization: Bearer $SOCHELI_API_KEY"

# Generate + publish a vertical post end to end
curl -s -X POST https://api.socheli.com/v1/generate \
  -H "Authorization: Bearer $SOCHELI_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"seed":"why we procrastinate","channel":"concept_lab","type":"auto"}'
```

Prefer typed calls? Use the [`@socheli/sdk`](https://github.com/Socheli/sdk):

```ts
import { createSocheli } from "@socheli/sdk";

const socheli = createSocheli({ apiKey: process.env.SOCHELI_API_KEY });

const { devices, online } = await socheli.fleet();
const { job } = await socheli.generate({ seed: "the science of habit", channel: "concept_lab" });
```

---

## API reference

**Base URL:** `https://api.socheli.com` · **Version prefix:** `/v1`

All responses are JSON. Errors are `{ "error": "message" }` with conventional status codes:
`400` bad input · `401` unauthorized · `404` not found · `502` broker down · `503` unconfigured.

### Reads

#### `GET /v1/health`
Open (no auth). Liveness + build info.

→ `{ ok: true, version: string, uptime: number }` — `uptime` in seconds.

#### `GET /v1/items`
List recent items.

**Query:** `limit` (number), `channel` (string).

→ `ItemSummary[]` — each `{ id, channel, status, title, createdAt, updatedAt, qa?, costUsd?, publish? }`.

#### `GET /v1/items/:id`
Full item.

→ `Item` (extends `ItemSummary`, adds `idea`, `script`, `storyboard`, `pkg`, `videoUrl`). `404` if missing.

#### `GET /v1/jobs`
The 30 most recent fleet jobs.

→ `JobRow[]` — each `{ id, type, status, device?, itemId?, progress[], … }`.

#### `GET /v1/fleet`
Devices + recent jobs + online count.

→ `FleetState` — `{ devices: Device[], jobs: JobRow[], online: number }`.

#### `GET /v1/schedule`
Read the current autopilot schedule (cadence + slots).

→ `Schedule`.

### Writes

#### `POST /v1/generate`
Dispatch a render job to the fleet. The central scheduler derives the job's capability requirements and routes it to the best-fit device over MQTT.

**Body:**

```json
{
  "seed": "the science of habit",
  "channel": "concept_lab",
  "type": "new",
  "mood": "explainer",
  "voice": false
}
```

| Field | Type | Notes |
| --- | --- | --- |
| `seed` | string | **Required.** `400 seed required` if absent. |
| `channel` | string | Defaults to `concept_lab`. |
| `type` | `"new"` \| `"auto"` | `"new"` = build only; `"auto"` = build + publish. Anything else coerces to `"new"`. |
| `mood` | string | Optional render mood (e.g. `explainer`, `cinematic`). |
| `voice` | boolean | `true` prefers a premium-voice-capable device. |

→ `{ dispatched: true, job, device, routing }`.

- `503` with `{ error, requirements }` if no online device satisfies the job's hard requirement (`render`).
- `502 broker unreachable: <message>` if the MQTT broker can't be reached.

**Scheduler behavior** (from `match.ts`): every generation job hard-requires the `render` capability. Music (`music:musicgen`), b-roll (`broll:sdturbo`, `broll:pexels`), and — when `voice: true` — premium voice (`voice:eleven`) are **preferences**; a minimal device still renders, degrading gracefully. Among capable online devices, an `idle` device is strongly preferred (+100), each matched preference adds +10, and more RAM breaks ties.

#### `POST /v1/items/:id/publish`
Publish an existing item to all configured platforms (server-side). Spawns the engine's `publish` command detached.

**Body:**

```json
{ "public": true, "aigc": true }
```

| Field | Type | Effect |
| --- | --- | --- |
| `public` | boolean | `true` adds `--public`. |
| `aigc` | boolean | `false` adds `--no-aigc` (AIGC disclosure on by default). |

→ `{ dispatched: true }`.

#### `PUT /v1/schedule`
Replace the autopilot schedule (cadence + slots). Persists to `schedule.json` and stamps `updatedAt`.

**Body:** a `Schedule` object. `400 bad schedule` if the body isn't an object.

→ the saved `Schedule`.

---

## SDK method ↔ endpoint map

The [`@socheli/sdk`](https://github.com/Socheli/sdk) `SocheliClient` mirrors this API one-to-one. Zero runtime dependencies — just `fetch` (Node 18+, Bun, Deno, edge).

| SDK call | HTTP |
| --- | --- |
| `socheli.health()` | `GET /v1/health` |
| `socheli.items.list({ limit?, channel? })` | `GET /v1/items` |
| `socheli.items.get(id)` | `GET /v1/items/:id` |
| `socheli.items.publish(id, input?)` | `POST /v1/items/:id/publish` |
| `socheli.generate(input)` | `POST /v1/generate` |
| `socheli.jobs()` | `GET /v1/jobs` |
| `socheli.fleet()` | `GET /v1/fleet` |
| `socheli.schedule.get()` | `GET /v1/schedule` |
| `socheli.schedule.set(schedule)` | `PUT /v1/schedule` |

```ts
import { createSocheli, SocheliError } from "@socheli/sdk";

// apiKey  ← opts.apiKey ?? process.env.SOCHELI_API_KEY
// baseUrl ← opts.baseUrl ?? process.env.SOCHELI_API_URL ?? https://api.socheli.com
const socheli = createSocheli();

try {
  const items = await socheli.items.list({ channel: "concept_lab", limit: 10 });
} catch (e) {
  if (e instanceof SocheliError) console.error(e.status, e.message, e.body);
}
```

---

## Configuration

The server reads everything from environment variables.

| Variable | Default | Purpose |
| --- | --- | --- |
| `SOCHELI_API_KEY` | _(none)_ | Bearer key required by all `/v1/*` routes except `/v1/health`. |
| `SOCHELI_API_PORT` | `8787` | Listen port. |
| `SOCHELI_BROKER_URL` | `mqtt://127.0.0.1:1883` | MQTT broker for fleet dispatch. |
| `SOCHELI_MQTT_USER` | _(none)_ | MQTT username. |
| `SOCHELI_MQTT_PASS` | _(none)_ | MQTT password. |
| `SOCHELI_DATA_DIR` | `<root>/data` | File store root (items, jobs, fleet, schedule). |
| `SOCHELI_RENDERS_DIR` | `<DATA_DIR>/renders` | Rendered output directory. |

Client-side, `@socheli/sdk` honors `SOCHELI_API_KEY` and `SOCHELI_API_URL`.

### MQTT dispatch

`POST /v1/generate` connects to the broker (`SOCHELI_BROKER_URL`, with optional user/pass and an 8s connect timeout) and publishes the job to:

```
socheli/device/<device>/jobs        (QoS 1)
```

where `<device>` is the device chosen by the central scheduler.

---

## Errors

All errors return JSON `{ "error": "message" }`:

| Status | When |
| --- | --- |
| `400` | Bad input (`seed required`, `bad schedule`). |
| `401` | Wrong or missing API key. |
| `404` | Item or route not found. |
| `502` | Broker unreachable during dispatch. |
| `503` | API not configured, or no online device satisfies the job. |

---

## The Socheli family

`@socheli/api` is one of four packages — pick the surface that fits your stack. All speak to the same control plane.

| Package | What it is | Repo |
| --- | --- | --- |
| **`@socheli/api`** | REST control plane (Hono) at `api.socheli.com`, with MQTT fleet dispatch. | [Socheli/api](https://github.com/Socheli/api) |
| `@socheli/sdk` | Official zero-dependency TypeScript client. | [Socheli/sdk](https://github.com/Socheli/sdk) |
| `@socheli/cli` | The `socheli` command-line interface. | [Socheli/cli](https://github.com/Socheli/cli) |
| `@socheli/mcp` | Model Context Protocol server — Socheli as agent tools. | [Socheli/mcp](https://github.com/Socheli/mcp) |

**Docs:** [socheli.com/docs](https://socheli.com/docs)

---

## Developed in the Socheli monorepo

`@socheli/api` is developed and released from the [Socheli monorepo](https://github.com/Socheli), alongside the engine, SDK, CLI, MCP server, and dashboard. This repo mirrors the `packages/api` workspace.

---

## License

MIT
