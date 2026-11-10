import "dotenv/config";
import { claimJob } from "./claim-job.js";

async function main() {
  const job = await claimJob("worker-A");

  if (job) {
    console.log("Claimed job:", job);
  } else {
    console.log("No eligible jobs available.");
  }
}

main().catch(console.error);
