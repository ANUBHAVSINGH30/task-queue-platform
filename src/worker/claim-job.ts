import { prisma } from "../lib/prisma";

type ClaimedJob = {
  id: string;
  type: string;
  payload: unknown;
  status: string;
  attempts: number;
  maxAttempts: number;
  leaseVersion: number;
  lockedBy: string | null;
  leaseExpiresAt: Date | null;
  runAt: Date;
};

export async function claimJob(workerId: string) {
  const jobs = await prisma.$queryRaw<ClaimedJob[]>`
    WITH candidate AS (
      SELECT id
      FROM jobs
      WHERE status = 'QUEUED'
        AND "runAt" <= NOW()
        AND attempts < "maxAttempts"
      ORDER BY "runAt", "createdAt"
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    UPDATE jobs AS j
    SET
      status = 'RUNNING',
      "lockedBy" = ${workerId},
      "lockedAt" = NOW(),
      "leaseExpiresAt" = NOW() + INTERVAL '60 seconds',
      "leaseVersion" = j."leaseVersion" + 1,
      attempts = j.attempts + 1,
      "startedAt" = COALESCE(j."startedAt", NOW()),
      "updatedAt" = NOW()
    FROM candidate
    WHERE j.id = candidate.id
    RETURNING
      j.id,
      j.type,
      j.payload,
      j.status,
      j.attempts,
      j."maxAttempts",
      j."leaseVersion",
      j."lockedBy",
      j."leaseExpiresAt",
      j."runAt";
  `;

  return jobs[0] ?? null;
}