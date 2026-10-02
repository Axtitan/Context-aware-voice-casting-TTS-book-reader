/**
 * Job queue: DB-backed job records + an in-process worker loop (singleton per server process).
 * HTTP requests only enqueue; workers do the long-running document/analysis/TTS work.
 * For horizontal scaling, run `npm run worker` on dedicated machines (same code path, JOB_WORKER=1).
 */
import { db } from "@/db";
import { jobs, type Job, type JobType } from "@/db/schema";
import { and, asc, eq, inArray } from "drizzle-orm";

export type ProgressReporter = (update: { stage?: string; progress?: number; stats?: Record<string, number | string | boolean> }) => Promise<void>;
type Handler = (job: Job, report: ProgressReporter) => Promise<void>;

const handlers: Partial<Record<JobType, Handler>> = {};
const CONCURRENCY = Number(process.env.JOB_CONCURRENCY ?? 1);

type QueueState = { running: Set<string>; loopScheduled: boolean; booted: boolean };
const g = globalThis as typeof globalThis & { __abxQueue?: QueueState };
const state: QueueState = g.__abxQueue ?? (g.__abxQueue = { running: new Set(), loopScheduled: false, booted: false });

export function registerHandler(type: JobType, h: Handler) {
  handlers[type] = h;
}

export async function enqueue(bookId: string, type: JobType, payload: Record<string, unknown> = {}): Promise<Job> {
  // De-duplicate: if an identical job is already queued/running, return it.
  const [existing] = await db.select().from(jobs).where(and(eq(jobs.bookId, bookId), eq(jobs.type, type), inArray(jobs.status, ["queued", "running"]))).limit(1);
  if (existing && JSON.stringify(existing.payload) === JSON.stringify(payload)) return existing;
  const [job] = await db.insert(jobs).values({ bookId, type, payload, stage: "Queued" }).returning();
  kick();
  return job;
}

export function kick() {
  if (state.loopScheduled) return;
  state.loopScheduled = true;
  setTimeout(() => {
    state.loopScheduled = false;
    void tick();
  }, 10);
}

async function tick() {
  if (state.running.size >= CONCURRENCY) return;
  const slots = CONCURRENCY - state.running.size;
  const queued = await db.select().from(jobs).where(eq(jobs.status, "queued")).orderBy(asc(jobs.createdAt)).limit(slots);
  for (const job of queued) {
    if (state.running.has(job.id)) continue;
    // Claim atomically
    const claimed = await db.update(jobs).set({ status: "running", stage: "Starting", updatedAt: new Date() }).where(and(eq(jobs.id, job.id), eq(jobs.status, "queued"))).returning();
    if (!claimed.length) continue;
    state.running.add(job.id);
    void run(claimed[0]).finally(() => {
      state.running.delete(job.id);
      kick();
    });
  }
}

async function run(job: Job) {
  const handler = handlers[job.type];
  const report: ProgressReporter = async (u) => {
    await db
      .update(jobs)
      .set({ ...(u.stage !== undefined ? { stage: u.stage } : {}), ...(u.progress !== undefined ? { progress: Math.max(0, Math.min(1, u.progress)) } : {}), ...(u.stats ? { stats: u.stats } : {}), updatedAt: new Date() })
      .where(eq(jobs.id, job.id));
  };
  try {
    if (!handler) throw new Error(`No handler for job type ${job.type}`);
    await handler(job, report);
    await db.update(jobs).set({ status: "done", progress: 1, stage: "Done", updatedAt: new Date() }).where(eq(jobs.id, job.id));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[jobs] ${job.type} ${job.id} failed:`, e);
    await db.update(jobs).set({ status: "failed", error: msg.slice(0, 2000), stage: "Failed", updatedAt: new Date() }).where(eq(jobs.id, job.id));
  }
}

/** On first import in a process: requeue jobs left "running" by a crashed process, then start the loop. */
export async function bootQueue() {
  if (state.booted) return;
  state.booted = true;
  try {
    await db.update(jobs).set({ status: "queued", stage: "Requeued after restart" }).where(eq(jobs.status, "running"));
  } catch (e) {
    console.warn("[jobs] boot requeue failed", e);
  }
  kick();
  setInterval(kick, 15000).unref?.();
}

export async function isJobCancelled(jobId: string): Promise<boolean> {
  const [j] = await db.select({ status: jobs.status }).from(jobs).where(eq(jobs.id, jobId)).limit(1);
  return !j || j.status === "cancelled";
}
