import "dotenv/config";
import express from "express";
import { PrismaClient } from "@prisma/client";

const app = express();
const prisma = new PrismaClient();
const port = 3000;

app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.post("/jobs", async (req, res) => {
  try {
    const { type, payload } = req.body;

    if (typeof type !== "string" || type.trim() === "") {
      return res.status(400).json({ error: "type is required" });
    }

    if (payload === undefined || payload === null) {
      return res.status(400).json({ error: "payload is required" });
    }

    const job = await prisma.job.create({
      data: {
        type,
        payload,
      },
    });

    return res.status(201).json(job);
  } catch (error) {
    console.error("Failed to create job:", error);
    return res.status(500).json({ error: "Failed to create job" });
  }
});

app.listen(port, () => {
  console.log(`API listening on port ${port}`);
});
