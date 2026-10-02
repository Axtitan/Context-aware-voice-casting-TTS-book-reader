/** Standalone job worker: `npx tsx scripts/worker.ts` – runs the same handlers as the web process on a dedicated machine. */
import "dotenv/config";
import "../src/lib/jobs";
console.log("[worker] VoxLibris job worker running (concurrency", process.env.JOB_CONCURRENCY ?? 1, ")");
setInterval(() => {}, 1 << 30);
