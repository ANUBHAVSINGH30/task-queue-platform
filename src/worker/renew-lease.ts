import { prisma } from "../lib/prisma.js";

export async function renewLease(
  jobId: string,
  workerId: string,
  leaseVersion: number,
): Promise<boolean> {
  const updated = await prisma.$executeRaw`
    UPDATE jobs
    SET
      "leaseExpiresAt" = NOW() + INTERVAL '60 seconds',
      "updatedAt" = NOW()
    WHERE id = ${jobId}
      AND status = 'RUNNING'
      AND "lockedBy" = ${workerId}
      AND "leaseVersion" = ${leaseVersion}
      AND "leaseExpiresAt" > NOW()
  `;

  return updated === 1;
}