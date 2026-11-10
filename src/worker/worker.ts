import "dotenv/config";
import { prisma } from "../lib/prisma.js";
import { claimJob } from "./claim-job.js";
import { PermanentJobError } from "./job-errors.js";
import { renewLease } from "./renew-lease.js";

const workerId = `worker-${process.pid}`;
const POLL_INTERVAL_MS = 2_000;

let shuttingDown = false;

type Job = NonNullable<Awaited<ReturnType<typeof claimJob>>>;

const HEARTBEAT_INTERVAL_MS = 20_000;

function startLeaseHeartbeat(job: Job) {
  let leaseLost = false;
  let heartbeatInFlight: Promise<void> | null = null;

  const timer = setInterval(() => {
    // Never overlap renewals or continue after losing ownership.
    if (leaseLost || heartbeatInFlight) return;

    heartbeatInFlight = renewLease(
      job.id,
      job.lockedBy!,
      job.leaseVersion,
    )
      .then((renewed) => {
        if (!renewed) {
          leaseLost = true;
          console.error(`Lease lost for job ${job.id}`);
        }
      })
      .catch((error: unknown) => {
        leaseLost = true;
        console.error(`Heartbeat failed for job ${job.id}:`, error);
      })
      .finally(() => {
        heartbeatInFlight = null;
      });
  }, HEARTBEAT_INTERVAL_MS);

  return {
    get lost() {
      return leaseLost;
    },

    async stop() {
      clearInterval(timer);

      // Wait for any renewal already in progress.
      if (heartbeatInFlight) {
        await heartbeatInFlight;
      }
    },
  };
}

async function processJob(job: Job): Promise<unknown> {
  console.log(`Processing ${job.id} (${job.type})`);

  switch (job.type) {
    case "generate_report": {
      const payload = job.payload as {
        reportName?: string;
        year?: number;
      };

      // Our first real handler: validate and process the input.
      if (
        typeof payload.reportName !== "string" ||
        typeof payload.year !== "number"
      ) {
        throw new Error("Invalid report payload");
      }

      const result = {
        reportName: payload.reportName,
        year: payload.year,
        generatedAt: new Date().toISOString(),
        message: `Report request processed for ${payload.year}`,
      };

      return result;
    }

    default:
      throw new PermanentJobError(
        `Unsupported job type: ${job.type}`,
      );
  }
}

async function runOnce(): Promise<void> {
  const job = await claimJob(workerId);

  if (!job) {
    return;
  }

  try {
    const heartbeat = startLeaseHeartbeat(job);

    let result: unknown;

    try {
    result = await processJob(job);
    } finally {
    await heartbeat.stop();
    }

    if (heartbeat.lost) {
    console.error(
        `Job ${job.id} finished, but ownership could not be confirmed.`,
    );
    return;
    }

    const update = await prisma.job.updateMany({
      where: {
        id: job.id,
        status: "RUNNING",
        lockedBy: workerId,
        leaseVersion: job.leaseVersion,
      },
      data: {
        status: "SUCCEEDED",
        result: result as object,
        finishedAt: new Date(),
        lockedBy: null,
        lockedAt: null,
        leaseExpiresAt: null,
      },
    });

    if (update.count === 0) {
      console.error(`Lost ownership of job ${job.id}; result not saved`);
      return;
    }

    console.log(`Job ${job.id} completed successfully`);
  } catch (error) {
        const message =
        error instanceof Error ? error.message : String(error);

        const permanent = error instanceof PermanentJobError;
        const attemptsExhausted = job.attempts >= job.maxAttempts;
        const shouldRetry = !permanent && !attemptsExhausted;

        const delaySeconds =
        job.attempts === 1 ? 5 : 15;

        const update = await prisma.job.updateMany({
            where: {
                id: job.id,
                status: "RUNNING",
                lockedBy: workerId,
                leaseVersion: job.leaseVersion,
            },
            data: {
                status: shouldRetry ? "QUEUED" : "FAILED",
                runAt: shouldRetry
                ? new Date(Date.now() + delaySeconds * 1000)
                : job.runAt,
                lastError: message,
                finishedAt: shouldRetry ? null : new Date(),
                lockedBy: null,
                lockedAt: null,
                leaseExpiresAt: null,
            },
        });

        if (update.count === 0) {
            console.error(
                `Lost ownership of job ${job.id}; failure not saved`,
            );
            return;
        }

        if (shouldRetry) {
            console.log(
                `Job ${job.id} will retry in ${delaySeconds} seconds`,
            );
        } else {
            console.error(
                `Job ${job.id} permanently failed: ${message}`,
            );
        }
    }
}

async function main(): Promise<void> {
  console.log(`Worker ${workerId} started`);

  while (!shuttingDown) {
    try {
      await runOnce();
    } catch (error) {
      console.error("Worker error:", error);
    }

    if (!shuttingDown) {
      await new Promise((resolve) =>
        setTimeout(resolve, POLL_INTERVAL_MS),
      );
    }
  }
}

process.on("SIGINT", () => {
  shuttingDown = true;
  console.log("Shutdown requested...");
});

process.on("SIGTERM", () => {
  shuttingDown = true;
  console.log("Shutdown requested...");
});

main()
  .catch((error) => {
    console.error("Worker stopped unexpectedly:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
