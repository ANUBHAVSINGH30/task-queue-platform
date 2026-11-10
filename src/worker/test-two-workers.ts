
import "dotenv/config";
import { claimJob } from "./claim-job.js";

async function main() {
  const results = await Promise.all([
    claimJob("worker-A"),
    claimJob("worker-B"),
  ]);

  console.log("Worker A received:", results[0]?.id ?? "No job");
  console.log("Worker B received:", results[1]?.id ?? "No job");
}

main().catch(console.error);
