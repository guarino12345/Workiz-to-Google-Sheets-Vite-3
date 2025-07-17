import express from "express";
import cors from "cors";
import { MongoClient, ObjectId } from "mongodb";
import dotenv from "dotenv";
import { google } from "googleapis";
import { formatInTimeZone } from "date-fns-tz";

dotenv.config();

const app = express();
const port = process.env.PORT || 3001;

// Enhanced error handling utilities

// Circuit Breaker Pattern for API resilience
class CircuitBreaker {
  constructor(failureThreshold = 5, recoveryTimeout = 300000) {
    // 5 failures, 5 minutes recovery
    this.failureThreshold = failureThreshold;
    this.recoveryTimeout = recoveryTimeout;
    this.failureCount = 0;
    this.lastFailureTime = null;
    this.state = "CLOSED"; // CLOSED, OPEN, HALF_OPEN
  }

  async execute(operation) {
    if (this.state === "OPEN") {
      if (Date.now() - this.lastFailureTime >= this.recoveryTimeout) {
        console.log("🔄 Circuit breaker transitioning to HALF_OPEN state");
        this.state = "HALF_OPEN";
      } else {
        throw new Error("Circuit breaker is OPEN - too many recent failures");
      }
    }

    try {
      const result = await operation();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  onSuccess() {
    this.failureCount = 0;
    this.state = "CLOSED";
    // console.log("✅ Circuit breaker reset to CLOSED state");
  }

  onFailure() {
    this.failureCount++;
    this.lastFailureTime = Date.now();

    if (this.failureCount >= this.failureThreshold) {
      this.state = "OPEN";
      console.log(
        `🚨 Circuit breaker opened after ${
          this.failureCount
        } failures. Will retry in ${this.recoveryTimeout / 1000} seconds`
      );
    } else {
      console.log(
        `⚠️ Circuit breaker failure count: ${this.failureCount}/${this.failureThreshold}`
      );
    }
  }

  getState() {
    return {
      state: this.state,
      failureCount: this.failureCount,
      lastFailureTime: this.lastFailureTime,
      timeUntilRecovery:
        this.state === "OPEN"
          ? Math.max(
              0,
              this.recoveryTimeout - (Date.now() - this.lastFailureTime)
            )
          : 0,
    };
  }
}

// Global circuit breaker instances
const workizCircuitBreaker = new CircuitBreaker(5, 300000); // 5 failures, 5 minutes recovery
const sheetsCircuitBreaker = new CircuitBreaker(3, 180000); // 3 failures, 3 minutes recovery

// Batch Processing Manager for handling large job updates
class BatchProcessingManager {
  static async createBatchState(db, accountId, totalJobs, batchSize = 29) {
    const totalBatches = Math.ceil(totalJobs / batchSize);
    const batchState = {
      accountId: accountId,
      totalJobs: totalJobs,
      totalBatches: totalBatches,
      currentBatch: 0,
      processedJobs: 0,
      updatedJobs: 0,
      deletedJobs: 0,
      failedUpdates: 0,
      status: "running", // running, completed, failed, paused
      startTime: new Date(),
      lastBatchTime: new Date(),
      nextBatchTime: new Date(),
      estimatedCompletionTime: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const result = await db.collection("batchProcessing").insertOne(batchState);
    console.log(`📦 Created batch processing state: ${result.insertedId}`);
    return batchState;
  }

  static async getBatchState(db, accountId) {
    return await db.collection("batchProcessing").findOne({
      accountId: accountId,
      status: { $in: ["running", "paused"] },
    });
  }

  static async updateBatchState(db, accountId, updates) {
    const result = await db.collection("batchProcessing").updateOne(
      { accountId: accountId },
      {
        $set: {
          ...updates,
          updatedAt: new Date(),
        },
      }
    );
    return result.modifiedCount > 0;
  }

  static async completeBatchState(db, accountId, finalStats) {
    const result = await db.collection("batchProcessing").updateOne(
      { accountId: accountId },
      {
        $set: {
          status: "completed",
          ...finalStats,
          completedAt: new Date(),
          updatedAt: new Date(),
        },
      }
    );
    return result.modifiedCount > 0;
  }

  static async failBatchState(db, accountId, error) {
    const result = await db.collection("batchProcessing").updateOne(
      { accountId: accountId },
      {
        $set: {
          status: "failed",
          error: error.message,
          failedAt: new Date(),
          updatedAt: new Date(),
        },
      }
    );
    return result.modifiedCount > 0;
  }

  static async scheduleNextBatch(db, accountId, nextBatchTime) {
    const result = await db.collection("batchProcessing").updateOne(
      { accountId: accountId },
      {
        $set: {
          nextBatchTime: nextBatchTime,
          status: "paused",
          updatedAt: new Date(),
        },
      }
    );
    return result.modifiedCount > 0;
  }

  static async stopBatchProcessing(db, accountId) {
    const result = await db.collection("batchProcessing").updateOne(
      { accountId: accountId },
      {
        $set: {
          status: "stopped",
          stopRequested: new Date(),
          updatedAt: new Date(),
        },
      }
    );
    return result.modifiedCount > 0;
  }

  static async resumeBatchProcessing(db, accountId) {
    const result = await db.collection("batchProcessing").updateOne(
      { accountId: accountId },
      {
        $set: {
          status: "running",
          stopRequested: null,
          updatedAt: new Date(),
        },
      }
    );
    return result.modifiedCount > 0;
  }

  static calculateTimeoutBuffer(startTime, maxDuration = 700000) {
    // 700s buffer (11.67 minutes)
    const elapsed = Date.now() - startTime;
    const remaining = maxDuration - elapsed;
    return remaining;
  }

  static shouldUseCronScheduling(remainingTime, batchProcessingTime) {
    // If remaining time is less than 2x the expected batch processing time, use cron
    return remainingTime < batchProcessingTime * 2;
  }
}

// Enhanced error handling with retry logic
class RetryHandler {
  static async withRetry(
    operation,
    maxRetries = 3,
    delay = 1000,
    circuitBreaker = null
  ) {
    let lastError;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        // Use circuit breaker if provided
        if (circuitBreaker) {
          return await circuitBreaker.execute(operation);
        }
        return await operation();
      } catch (error) {
        lastError = error;

        // Check if it's a circuit breaker error
        if (error.message.includes("Circuit breaker is OPEN")) {
          console.log(`🚨 Circuit breaker blocked operation: ${error.message}`);
          throw error;
        }

        // Handle 520 errors with longer delays
        const is520Error =
          error.message.includes("520") ||
          (error.response && error.response.status === 520);

        if (is520Error) {
          console.log(
            `⚠️ 520 error detected on attempt ${attempt}, using extended delay`
          );
          // Use longer delays for 520 errors: 10s, 20s, 40s
          const waitTime = 10000 * Math.pow(2, attempt - 1);
          console.log(
            `⏳ Waiting ${waitTime / 1000}s before retry due to 520 error`
          );
          await new Promise((resolve) => setTimeout(resolve, waitTime));
        } else if (attempt === maxRetries) {
          throw error;
        } else {
          // Exponential backoff for other errors
          const waitTime = delay * Math.pow(2, attempt - 1);
          console.log(
            `⚠️ Attempt ${attempt} failed, retrying in ${waitTime}ms: ${error.message}`
          );
          await new Promise((resolve) => setTimeout(resolve, waitTime));
        }
      }
    }
  }
}

// API rate limiting and timeout handling
class APIManager {
  static async fetchWithTimeout(url, options = {}, timeout = 30000) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      // Check for 520 error specifically
      if (response.status === 520) {
        console.log(`🚨 520 error detected from Workiz API`);
        throw new Error(`Workiz API 520 error - server is experiencing issues`);
      }

      return response;
    } catch (error) {
      clearTimeout(timeoutId);
      if (error.name === "AbortError") {
        throw new Error(`Request timeout after ${timeout}ms`);
      }
      throw error;
    }
  }

  static async handleRateLimit(response, retryAfter = 60) {
    if (response.status === 429) {
      console.log(`⏳ Rate limited, waiting ${retryAfter} seconds...`);
      await new Promise((resolve) => setTimeout(resolve, retryAfter * 1000));
      return true;
    }
    return false;
  }
}

// Database connection management with health checks
class DatabaseManager {
  static async healthCheck(db) {
    try {
      await db.admin().ping();
      return true;
    } catch (error) {
      console.error("❌ Database health check failed:", error.message);
      return false;
    }
  }

  static async ensureHealthyConnection(db) {
    const isHealthy = await this.healthCheck(db);
    if (!isHealthy) {
      throw new Error("Database connection is unhealthy");
    }
  }
}

// Global error handler
process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled Rejection at:", promise, "reason:", reason);
});

process.on("uncaughtException", (error) => {
  console.error("Uncaught Exception:", error);
  process.exit(1);
});

app.use(cors());
app.use(express.json());

// Global error handler middleware
app.use((err, req, res, next) => {
  console.error("Unhandled error:", err);
  res.status(500).json({
    error: "Internal server error",
    message: err.message,
    timestamp: new Date().toISOString(),
  });
});

// Health check endpoint
app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    message: "Server is running",
  });
});

// Database test endpoint
app.get("/api/test-db", async (req, res) => {
  try {
    const db = await ensureDbConnection();
    const collections = await db.listCollections().toArray();
    res.json({
      status: "ok",
      message: "Database connection successful",
      collections: collections.map((c) => c.name),
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Database test failed:", error);
    res.status(500).json({
      status: "error",
      message: "Database connection failed",
      error: error.message,
      timestamp: new Date().toISOString(),
    });
  }
});

const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
  console.error("MONGODB_URI is not defined in environment variables");
  process.exit(1);
}

let db;

async function connectToMongoDB() {
  try {
    const client = await MongoClient.connect(MONGODB_URI);
    db = client.db();
    console.log("Connected to MongoDB Atlas");
  } catch (error) {
    console.error("Error connecting to MongoDB:", error);
    process.exit(1);
  }
}

// Helper function to ensure database connection
async function ensureDbConnection() {
  if (!db) {
    console.log("🔄 Establishing database connection...");
    await connectToMongoDB();
  }
  return db;
}

// Account management endpoints
app.post("/api/accounts", async (req, res) => {
  try {
    const db = await ensureDbConnection();
    const accountData = {
      ...req.body,
      timezone: req.body.timezone ?? "America/Los_Angeles", // Default timezone
      syncEnabled: false, // Disabled by default - using Vercel cron jobs instead
      syncFrequency: req.body.syncFrequency ?? "daily",
      syncTime: req.body.syncTime ?? "09:00",
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const result = await db.collection("accounts").insertOne(accountData);
    res.json(result);
  } catch (error) {
    console.error("Error creating account:", error);
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/accounts", async (req, res) => {
  try {
    const db = await ensureDbConnection();
    const accounts = await db.collection("accounts").find().toArray();
    // Transform _id to id for frontend
    const transformedAccounts = accounts.map((account) => ({
      ...account,
      id: account._id.toString(),
      _id: undefined,
    }));
    res.json(transformedAccounts);
  } catch (error) {
    console.error("Error fetching accounts:", error);
    res.status(500).json({ error: error.message });
  }
});

app.put("/api/accounts/:id", async (req, res) => {
  try {
    const db = await ensureDbConnection();
    const { id, ...updateData } = req.body;
    const updatePayload = {
      ...updateData,
      updatedAt: new Date(),
    };

    const result = await db
      .collection("accounts")
      .updateOne({ _id: new ObjectId(req.params.id) }, { $set: updatePayload });

    if (result.matchedCount === 0) {
      return res.status(404).json({ error: "Account not found" });
    }

    const updatedAccount = await db
      .collection("accounts")
      .findOne({ _id: new ObjectId(req.params.id) });

    // Transform _id to id for frontend
    const transformedAccount = {
      ...updatedAccount,
      id: updatedAccount._id.toString(),
      _id: undefined,
    };

    res.json(transformedAccount);
  } catch (error) {
    console.error("Error updating account:", error);
    res.status(500).json({ error: error.message });
  }
});

app.delete("/api/accounts/:id", async (req, res) => {
  try {
    const db = await ensureDbConnection();
    const result = await db.collection("accounts").deleteOne({
      _id: new ObjectId(req.params.id),
    });

    if (result.deletedCount === 0) {
      return res.status(404).json({ error: "Account not found" });
    }

    res.json({ message: "Account deleted successfully" });
  } catch (error) {
    console.error("Error deleting account:", error);
    res.status(500).json({ error: error.message });
  }
});

// Sync history endpoints
app.post("/api/sync-history", async (req, res) => {
  try {
    const db = await ensureDbConnection();
    const syncHistoryData = {
      ...req.body,
      timestamp: new Date(),
      createdAt: new Date(),
    };
    const result = await db
      .collection("syncHistory")
      .insertOne(syncHistoryData);
    res.json(result);
  } catch (error) {
    console.error("Error creating sync history:", error);
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/sync-history/:accountId", async (req, res) => {
  try {
    const db = await ensureDbConnection();
    const { accountId } = req.params;

    // Try to find sync history with both ObjectId and string formats
    const syncHistory = await db
      .collection("syncHistory")
      .find({
        $or: [{ accountId: accountId }, { accountId: new ObjectId(accountId) }],
      })
      .sort({ timestamp: -1 })
      .limit(10) // Limit to last 10 sync records
      .toArray();

    // Transform _id to id for frontend
    const transformedHistory = syncHistory.map((record) => ({
      ...record,
      id: record._id.toString(),
      _id: undefined,
    }));

    res.json(transformedHistory);
  } catch (error) {
    console.error("Error fetching sync history:", error);
    res.status(500).json({ error: error.message });
  }
});

// Jobs endpoints
app.get("/api/jobs", async (req, res) => {
  try {
    const db = await ensureDbConnection();
    const jobs = await db
      .collection("jobs")
      .find()
      .sort({ JobDateTime: -1 })
      .toArray();
    res.json(jobs);
  } catch (error) {
    console.error("Error fetching jobs:", error);
    res.status(500).json({ error: error.message });
  }
});

// Sync jobs from Workiz and save to MongoDB
app.post("/api/sync-jobs/:accountId", async (req, res) => {
  const accountStartTime = Date.now();

  try {
    const db = await ensureDbConnection();
    const { accountId } = req.params;
    console.log(`🔍 Starting sync for account ID: ${accountId}`);

    // Find account by ID - try both id and _id fields
    const account = await db.collection("accounts").findOne({
      $or: [{ _id: new ObjectId(accountId) }, { id: accountId }],
    });

    if (!account) {
      console.log(`❌ Account not found for ID: ${accountId}`);
      return res.status(404).json({ error: "Account not found" });
    }

    console.log(
      `✅ Found account: ${account.name} (API Token: ${
        account.workizApiToken ? "Present" : "Missing"
      })`
    );

    if (!account.workizApiToken) {
      return res
        .status(400)
        .json({ error: "Missing API token for this account" });
    }

    // Calculate start_date as 2 months before current date
    const startDate = new Date();
    startDate.setMonth(startDate.getMonth() - 2);
    const startDateStr = startDate.toISOString().split("T")[0]; // Format as YYYY-MM-DD

    // Fetch jobs from Workiz API using the token from the account
    const workizUrl = `https://api.workiz.com/api/v1/${account.workizApiToken}/job/all/?start_date=${startDateStr}&offset=0&records=100&only_open=false`;
    console.log(`🌐 Fetching from Workiz: ${workizUrl}`);

    const response = await RetryHandler.withRetry(
      async () => {
        const resp = await APIManager.fetchWithTimeout(workizUrl, {}, 45000);

        if (!resp.ok) {
          const errorText = await resp.text();
          console.log(`❌ Workiz API error: ${resp.status} - ${errorText}`);

          // Check if response is HTML (520 error page)
          if (
            errorText.includes('<div class="text-container">') ||
            errorText.includes("Oops!") ||
            errorText.includes("Something went wrong")
          ) {
            console.log(
              `🚨 Detected HTML error page from Workiz API (likely 520 error)`
            );
            throw new Error(
              `Workiz API 520 error - server is experiencing issues`
            );
          }

          throw new Error(`Workiz API error: ${resp.status} - ${errorText}`);
        }

        return resp;
      },
      5,
      2000,
      workizCircuitBreaker
    ); // 5 retries, 2s base delay, with circuit breaker

    const data = await response.json();
    console.log(
      `📊 Workiz API response: flag=${data.flag}, data.length=${
        data.data?.length || 0
      }`
    );

    if (!data.flag || !Array.isArray(data.data)) {
      console.log(`❌ Invalid Workiz API response structure`);
      return res
        .status(500)
        .json({ error: "Invalid response from Workiz API" });
    }

    console.log(`📋 Processing ${data.data.length} jobs from Workiz`);

    // Add accountId to each job
    const allJobs = data.data.map((job) => ({
      ...job,
      accountId: account._id || account.id,
    }));

    // Filter jobs by sourceFilter if configured
    let filteredJobs = allJobs;
    if (
      account.sourceFilter &&
      Array.isArray(account.sourceFilter) &&
      account.sourceFilter.length > 0
    ) {
      filteredJobs = allJobs.filter((job) =>
        account.sourceFilter.includes(job.JobSource)
      );
      console.log(
        `🔍 Source filtering: ${allJobs.length} → ${filteredJobs.length} jobs`
      );
    }

    // Initialize jobsWithGclid variable
    let jobsWithGclid = 0;

    // Additional filtering by WhatConverts if API key and secret are configured
    if (
      account.whatconvertsApiKey &&
      account.whatconvertsApiSecret &&
      filteredJobs.length > 0
    ) {
      // Extract unique phone numbers from filtered jobs
      const phoneNumbers = [
        ...new Set(
          filteredJobs
            .map((job) => job.Phone)
            .filter((phone) => phone && phone.trim() !== "")
        ),
      ];

      // Check phones in WhatConverts
      const whatconvertsResults =
        await WhatConvertsAPI.checkMultiplePhonesInLeads(
          account.whatconvertsApiKey,
          account.whatconvertsApiSecret,
          phoneNumbers
        );

      // Filter jobs to only include those with phones found in WhatConverts AND have gclid
      const beforeWhatconvertsCount = filteredJobs.length;

      filteredJobs = filteredJobs.filter((job) => {
        if (!job.Phone || job.Phone.trim() === "") {
          return false;
        }

        const leadData = whatconvertsResults[job.Phone];
        if (!leadData || !leadData.exists) {
          return false;
        }

        if (!leadData.hasGclid) {
          return false;
        }

        // Job passes both filters - add WhatConverts data to job
        job.gclid = leadData.gclid;
        job.whatconvertsDateCreated = leadData.dateCreated;
        jobsWithGclid++;

        return true;
      });

      console.log(
        `🔍 WhatConverts filtering: ${beforeWhatconvertsCount} → ${filteredJobs.length} jobs (${jobsWithGclid} with gclid)`
      );
    } else if (account.whatconvertsApiKey || account.whatconvertsApiSecret) {
      console.log(
        `⚠️ WhatConverts API credentials incomplete - both key and secret required`
      );
    }

    if (filteredJobs.length === 0) {
      console.log(`⚠️ No jobs match the filtering criteria`);
      return res.json({
        message: `No jobs match the filtering criteria for account ${account.name}`,
        details: {
          jobsFromWorkiz: allJobs.length,
          filteredJobs: 0,
          sourceFilter: account.sourceFilter,
          whatconvertsEnabled: !!(
            account.whatconvertsApiKey && account.whatconvertsApiSecret
          ),
        },
      });
    }

    // Check for existing jobs with same UUIDs (only for filtered jobs)
    const existingJobCount = await db.collection("jobs").countDocuments({
      UUID: { $in: filteredJobs.map((job) => job.UUID) },
    });
    // Upsert filtered jobs into MongoDB
    const bulkOps = filteredJobs.map((job) => ({
      updateOne: {
        filter: { UUID: job.UUID },
        update: { $set: job },
        upsert: true,
      },
    }));

    if (bulkOps.length > 0) {
      const bulkResult = await db.collection("jobs").bulkWrite(bulkOps);
      console.log(
        `✅ Sync completed: ${filteredJobs.length} jobs processed (${bulkResult.upsertedCount} new, ${bulkResult.modifiedCount} updated)`
      );
    }

    // Verify final count
    const finalJobCount = await db.collection("jobs").countDocuments({
      accountId: account._id || account.id,
    });

    // Record sync history
    const syncHistoryRecord = {
      accountId: account._id || account.id,
      syncType: "jobs",
      status: "success",
      timestamp: new Date(),
      duration: Date.now() - accountStartTime,
      details: {
        jobsFromWorkiz: allJobs.length,
        filteredJobs: filteredJobs.length,
        finalJobCount: finalJobCount,
        sourceFilter: account.sourceFilter,
        whatconvertsEnabled: !!(
          account.whatconvertsApiKey && account.whatconvertsApiSecret
        ),
        whatconvertsStats:
          account.whatconvertsApiKey && account.whatconvertsApiSecret
            ? {
                jobsWithGclid: filteredJobs.filter((j) => j.gclid).length,
                jobsWithoutGclid:
                  filteredJobs.length -
                  filteredJobs.filter((j) => j.gclid).length,
                totalJobsWithGclid: jobsWithGclid || 0,
              }
            : null,
        syncMethod: "manual",
        jobStatusBreakdown: {
          submitted: filteredJobs.filter((j) => j.Status === "Submitted")
            .length,
          pending: filteredJobs.filter((j) => j.Status === "Pending").length,
          completed: filteredJobs.filter(
            (j) =>
              j.Status === "Completed" || j.Status === "done pending approval"
          ).length,
          cancelled: filteredJobs.filter((j) =>
            ["Cancelled", "Canceled", "cancelled", "CANCELLED"].includes(
              j.Status
            )
          ).length,
        },
      },
    };

    await RetryHandler.withRetry(async () => {
      await db.collection("syncHistory").insertOne(syncHistoryRecord);
    });

    // Update account's lastSyncDate
    await RetryHandler.withRetry(async () => {
      await db
        .collection("accounts")
        .updateOne(
          { _id: account._id || new ObjectId(account.id) },
          { $set: { lastSyncDate: new Date() } }
        );
    });

    res.json({
      message: `Synced ${filteredJobs.length} jobs for account ${
        account.name || "Unknown"
      }`,
      details: {
        jobsFromWorkiz: allJobs.length,
        filteredJobs: filteredJobs.length,
        finalJobCount: finalJobCount,
        sourceFilter: account.sourceFilter,
        whatconvertsEnabled: !!(
          account.whatconvertsApiKey && account.whatconvertsApiSecret
        ),
      },
    });
  } catch (error) {
    console.log(`❌ Sync error: ${error.message}`);

    // Check if it's a circuit breaker error
    if (error.message.includes("Circuit breaker is OPEN")) {
      const workizState = workizCircuitBreaker.getState();
      console.log(
        `🚨 Circuit breaker blocked sync: ${workizState.state} state, ${workizState.failureCount} failures`
      );

      return res.status(503).json({
        error: "Service temporarily unavailable due to API issues",
        details: {
          circuitBreakerState: workizState.state,
          failureCount: workizState.failureCount,
          timeUntilRecovery: workizState.timeUntilRecovery,
          message: "Workiz API is experiencing issues. Please try again later.",
        },
      });
    }

    // Record failed sync history if we have account info
    if (req.params.accountId) {
      try {
        const syncHistoryRecord = {
          accountId: req.params.accountId,
          syncType: "jobs",
          status: "error",
          timestamp: new Date(),
          duration: Date.now() - accountStartTime,
          errorMessage: error.message,
          details: {},
        };
        await db.collection("syncHistory").insertOne(syncHistoryRecord);
        console.log(`📝 Failed sync history recorded for jobs sync`);
      } catch (historyError) {
        console.log(
          `❌ Failed to record sync history: ${historyError.message}`
        );
      }
    }

    res.status(500).json({ error: error.message });
  }
});

// Job update and cleanup endpoint with hybrid batch processing
app.post("/api/update-cleanup-jobs/:accountId", async (req, res) => {
  const functionStartTime = Date.now();

  try {
    const db = await ensureDbConnection();
    const { accountId } = req.params;
    console.log(
      `🔄 Starting job update and cleanup for account ID: ${accountId}`
    );

    // Find account by ID - try both id and _id fields
    const account = await db.collection("accounts").findOne({
      $or: [{ _id: new ObjectId(accountId) }, { id: accountId }],
    });

    if (!account) {
      console.log(`❌ Account not found for ID: ${accountId}`);
      return res.status(404).json({ error: "Account not found" });
    }

    console.log(`✅ Found account: ${account.name}`);

    if (!account.workizApiToken) {
      return res
        .status(400)
        .json({ error: "Missing API token for this account" });
    }

    // Check if there's an existing batch processing state
    let batchState = await BatchProcessingManager.getBatchState(db, accountId);

    if (!batchState) {
      // Start new batch processing
      console.log(
        `🆕 Starting new batch processing for account ${account.name}`
      );

      // Get all existing jobs for this account
      const existingJobs = await db
        .collection("jobs")
        .find({ accountId: account._id || account.id })
        .toArray();

      console.log(`📋 Found ${existingJobs.length} existing jobs in database`);

      if (existingJobs.length === 0) {
        return res.json({
          message: `No jobs found for account ${account.name}`,
          details: {
            existingJobsFound: 0,
            jobsUpdated: 0,
            jobsDeleted: 0,
            failedUpdates: 0,
          },
        });
      }

      // Calculate 50-day cutoff date for job updates
      const fiftyDaysAgo = new Date();
      fiftyDaysAgo.setDate(fiftyDaysAgo.getDate() - 50);

      // Count total jobs within 50-day window for batch planning
      const totalJobsInWindow = await db.collection("jobs").countDocuments({
        accountId: account._id || account.id,
        JobDateTime: { $gte: fiftyDaysAgo.toISOString() },
      });

      console.log(
        `📅 Found ${totalJobsInWindow} jobs within 50-day window (since ${
          fiftyDaysAgo.toISOString().split("T")[0]
        })`
      );

      // Create batch processing state
      batchState = await BatchProcessingManager.createBatchState(
        db,
        accountId,
        totalJobsInWindow
      );
    } else {
      console.log(`🔄 Resuming batch processing for account ${account.name}`);
      console.log(
        `📊 Current progress: ${batchState.currentBatch}/${batchState.totalBatches} batches`
      );
    }

    // Calculate 50-day cutoff date for job updates
    const fiftyDaysAgo = new Date();
    fiftyDaysAgo.setDate(fiftyDaysAgo.getDate() - 50);

    // Get jobs for current batch (only jobs from last 50 days)
    const BATCH_SIZE = 29;
    const startIndex = batchState.currentBatch * BATCH_SIZE;
    const existingJobs = await db
      .collection("jobs")
      .find({
        accountId: account._id || account.id,
        JobDateTime: { $gte: fiftyDaysAgo.toISOString() },
      })
      .skip(startIndex)
      .limit(BATCH_SIZE)
      .toArray();

    if (existingJobs.length === 0) {
      // No more jobs to process, complete the batch state
      await BatchProcessingManager.completeBatchState(db, accountId, {
        processedJobs: batchState.processedJobs,
        updatedJobs: batchState.updatedJobs,
        deletedJobs: batchState.deletedJobs,
        failedUpdates: batchState.failedUpdates,
      });

      return res.json({
        message: `Job update and cleanup completed for account ${account.name}`,
        details: {
          totalJobsProcessed: batchState.processedJobs,
          jobsUpdated: batchState.updatedJobs,
          jobsDeleted: batchState.deletedJobs,
          failedUpdates: batchState.failedUpdates,
          duration: Date.now() - functionStartTime,
          processingMethod: "hybrid-batch",
          cutoffDate: fiftyDaysAgo.toISOString().split("T")[0],
        },
      });
    }

    // Calculate 1-year cutoff date
    const oneYearAgo = new Date();
    oneYearAgo.setDate(oneYearAgo.getDate() - 365);

    console.log(
      `📦 Processing batch ${batchState.currentBatch + 1}/${
        batchState.totalBatches
      } (${existingJobs.length} jobs)`
    );
    console.log(
      `📅 Only updating jobs from last 50 days (since ${
        fiftyDaysAgo.toISOString().split("T")[0]
      })`
    );
    console.log(
      `🗑️ Jobs older than ${
        oneYearAgo.toISOString().split("T")[0]
      } will be deleted`
    );

    const batchStartTime = Date.now();
    let batchUpdatedJobs = 0;
    let batchDeletedJobs = 0;
    let batchFailedUpdates = 0;

    // Process each job in the current batch
    for (const existingJob of existingJobs) {
      try {
        const jobDate = new Date(existingJob.JobDateTime);

        // Check if job is older than 1 year
        if (jobDate < oneYearAgo) {
          console.log(
            `🗑️ Deleting old job: ${existingJob.UUID} (${existingJob.JobDateTime})`
          );
          await RetryHandler.withRetry(async () => {
            await db.collection("jobs").deleteOne({ UUID: existingJob.UUID });
          });
          batchDeletedJobs++;
          continue;
        }

        // Update job using Workiz API
        const updateUrl = `https://api.workiz.com/api/v1/${account.workizApiToken}/job/get/${existingJob.UUID}/`;

        const updateResponse = await RetryHandler.withRetry(
          async () => {
            const resp = await APIManager.fetchWithTimeout(
              updateUrl,
              {},
              30000
            );

            if (!resp.ok) {
              const errorText = await resp.text();
              console.log(`❌ Job update error: ${resp.status} - ${errorText}`);

              // Check if response is HTML (520 error page)
              if (
                errorText.includes('<div class="text-container">') ||
                errorText.includes("Oops!") ||
                errorText.includes("Something went wrong")
              ) {
                console.log(
                  `🚨 Detected HTML error page from Workiz API (likely 520 error)`
                );
                throw new Error(
                  `Workiz API 520 error - server is experiencing issues`
                );
              }

              throw new Error(
                `Job update error: ${resp.status} - ${errorText}`
              );
            }

            return resp;
          },
          3,
          1000,
          workizCircuitBreaker
        );

        const updateData = await updateResponse.json();

        if (updateData.flag && updateData.data && updateData.data.length > 0) {
          // Update the job with fresh data from Workiz using upsert
          const jobData = updateData.data[0];
          const updatedJob = {
            ...jobData,
            accountId: account._id || account.id,
          };

          await RetryHandler.withRetry(async () => {
            await db
              .collection("jobs")
              .updateOne(
                { UUID: existingJob.UUID },
                { $set: updatedJob },
                { upsert: true }
              );
          });

          batchUpdatedJobs++;
        } else {
          console.log(`⚠️ Job not found in Workiz API: ${existingJob.UUID}`);
          // Job might have been deleted in Workiz, so delete from our database
          await RetryHandler.withRetry(async () => {
            await db.collection("jobs").deleteOne({ UUID: existingJob.UUID });
          });
          batchDeletedJobs++;
        }

        // Add a delay between individual job updates (5000ms)
        await new Promise((resolve) => setTimeout(resolve, 5000));
      } catch (error) {
        // Check if it's a circuit breaker error
        if (error.message.includes("Circuit breaker is OPEN")) {
          console.log(
            `🚨 Circuit breaker blocked job update for ${existingJob.UUID}`
          );
          continue;
        }

        console.log(
          `❌ Error processing job ${existingJob.UUID}: ${error.message}`
        );
        batchFailedUpdates++;
      }
    }

    // Update batch state with current batch results
    const updatedStats = {
      currentBatch: batchState.currentBatch + 1,
      processedJobs: batchState.processedJobs + existingJobs.length,
      updatedJobs: batchState.updatedJobs + batchUpdatedJobs,
      deletedJobs: batchState.deletedJobs + batchDeletedJobs,
      failedUpdates: batchState.failedUpdates + batchFailedUpdates,
      lastBatchTime: new Date(),
    };

    await BatchProcessingManager.updateBatchState(db, accountId, updatedStats);

    const batchDuration = Date.now() - batchStartTime;
    console.log(
      `📊 Batch ${
        batchState.currentBatch + 1
      } completed in ${batchDuration}ms: ${batchUpdatedJobs} updated, ${batchDeletedJobs} deleted, ${batchFailedUpdates} failed`
    );

    // Check if this was the last batch
    if (updatedStats.currentBatch >= batchState.totalBatches) {
      // Complete the batch processing
      await BatchProcessingManager.completeBatchState(db, accountId, {
        processedJobs: updatedStats.processedJobs,
        updatedJobs: updatedStats.updatedJobs,
        deletedJobs: updatedStats.deletedJobs,
        failedUpdates: updatedStats.failedUpdates,
      });

      // Record sync history
      const syncHistoryRecord = {
        accountId: account._id || account.id,
        syncType: "update-cleanup",
        status: "success",
        timestamp: new Date(),
        duration: Date.now() - functionStartTime,
        details: {
          totalJobsProcessed: updatedStats.processedJobs,
          jobsUpdated: updatedStats.updatedJobs,
          jobsDeleted: updatedStats.deletedJobs,
          failedUpdates: updatedStats.failedUpdates,
          syncMethod: "hybrid-batch",
          totalBatches: batchState.totalBatches,
        },
      };

      await RetryHandler.withRetry(async () => {
        await db.collection("syncHistory").insertOne(syncHistoryRecord);
      });

      // Update account's lastUpdateCleanupDate
      await RetryHandler.withRetry(async () => {
        await db
          .collection("accounts")
          .updateOne(
            { _id: account._id || new ObjectId(account.id) },
            { $set: { lastUpdateCleanupDate: new Date() } }
          );
      });

      return res.json({
        message: `Job update and cleanup completed for account ${account.name}`,
        details: {
          totalJobsProcessed: updatedStats.processedJobs,
          jobsUpdated: updatedStats.updatedJobs,
          jobsDeleted: updatedStats.deletedJobs,
          failedUpdates: updatedStats.failedUpdates,
          duration: Date.now() - functionStartTime,
          processingMethod: "hybrid-batch",
          totalBatches: batchState.totalBatches,
        },
      });
    }

    // Always schedule next batch via cron (no more recursive calls)
    const nextBatchTime = new Date(Date.now() + 5 * 60 * 1000);
    await BatchProcessingManager.scheduleNextBatch(
      db,
      accountId,
      nextBatchTime
    );

    console.log(
      `⏰ Scheduled next batch for ${nextBatchTime.toISOString()} (cron scheduling)`
    );

    return res.json({
      message: `Batch ${
        batchState.currentBatch + 1
      } completed, next batch scheduled`,
      details: {
        currentBatch: batchState.currentBatch + 1,
        totalBatches: batchState.totalBatches,
        progress: `${Math.round(
          ((batchState.currentBatch + 1) / batchState.totalBatches) * 100
        )}%`,
        batchResults: {
          jobsProcessed: existingJobs.length,
          jobsUpdated: batchUpdatedJobs,
          jobsDeleted: batchDeletedJobs,
          failedUpdates: batchFailedUpdates,
        },
        totalProgress: {
          processedJobs: updatedStats.processedJobs,
          updatedJobs: updatedStats.updatedJobs,
          deletedJobs: updatedStats.deletedJobs,
          failedUpdates: updatedStats.failedUpdates,
        },
        nextBatchTime: nextBatchTime.toISOString(),
        processingMethod: "cron-scheduled",
        duration: Date.now() - functionStartTime,
      },
    });
  } catch (error) {
    console.log(`❌ Update and cleanup error: ${error.message}`);

    // Check if it's a circuit breaker error
    if (error.message.includes("Circuit breaker is OPEN")) {
      const workizState = workizCircuitBreaker.getState();
      console.log(
        `🚨 Circuit breaker blocked update/cleanup: ${workizState.state} state, ${workizState.failureCount} failures`
      );

      return res.status(503).json({
        error: "Service temporarily unavailable due to API issues",
        details: {
          circuitBreakerState: workizState.state,
          failureCount: workizState.failureCount,
          timeUntilRecovery: workizState.timeUntilRecovery,
          message: "Workiz API is experiencing issues. Please try again later.",
        },
      });
    }

    // Record failed sync history if we have account info
    if (req.params.accountId) {
      try {
        const syncHistoryRecord = {
          accountId: req.params.accountId,
          syncType: "update-cleanup",
          status: "error",
          timestamp: new Date(),
          duration: Date.now() - functionStartTime,
          errorMessage: error.message,
          details: {},
        };
        await db.collection("syncHistory").insertOne(syncHistoryRecord);
        console.log(`📝 Failed sync history recorded for update/cleanup`);
      } catch (historyError) {
        console.log(
          `❌ Failed to record sync history: ${historyError.message}`
        );
      }
    }

    res.status(500).json({ error: error.message });
  }
});

// Google Sheets integration endpoint
app.post("/api/sync-to-sheets/:accountId", async (req, res) => {
  const accountStartTime = Date.now();

  try {
    const { accountId } = req.params;
    console.log(`📊 Starting Google Sheets sync for account ID: ${accountId}`);

    // Find account by ID - try both id and _id fields
    const account = await db.collection("accounts").findOne({
      $or: [{ _id: new ObjectId(accountId) }, { id: accountId }],
    });

    if (!account) {
      console.log(`❌ Account not found for ID: ${accountId}`);
      return res.status(404).json({ error: "Account not found" });
    }

    console.log(`✅ Found account: ${account.name}`);
    console.log(
      `📋 Account sourceFilter: ${JSON.stringify(account.sourceFilter)}`
    );
    console.log(
      `💰 Default conversion value: ${account.defaultConversionValue}`
    );

    if (!account.googleSheetsId) {
      console.log(`❌ Missing Google Sheet ID for account: ${account.name}`);
      return res
        .status(400)
        .json({ error: "Missing Google Sheet ID for this account" });
    }

    console.log(`📄 Google Sheet ID: ${account.googleSheetsId}`);

    // Calculate date filter - only process jobs from last 30 days
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    
    // Get jobs for this account from last 30 days
    const allJobs = await db
      .collection("jobs")
      .find({ 
        accountId: account._id || account.id,
        JobDateTime: { $gte: thirtyDaysAgo.toISOString() }
      })
      .toArray();

    console.log(`📊 Found ${allJobs.length} jobs from last 30 days for account`);
    console.log(`📅 Date filter: jobs since ${thirtyDaysAgo.toISOString()}`);

    // Filter jobs by sourceFilter
    let filteredJobs = allJobs;
    if (
      account.sourceFilter &&
      Array.isArray(account.sourceFilter) &&
      account.sourceFilter.length > 0
    ) {
      filteredJobs = allJobs.filter((job) =>
        account.sourceFilter.includes(job.JobSource)
      );
      console.log(
        `🔍 Filtered jobs by sourceFilter: ${allJobs.length} → ${filteredJobs.length} jobs`
      );
      console.log(
        `📋 Job sources found: ${[
          ...new Set(filteredJobs.map((job) => job.JobSource)),
        ].join(", ")}`
      );
    } else {
      console.log(
        `⚠️ No sourceFilter configured, using all ${allJobs.length} jobs`
      );
    }

    // Determine if account has WhatConverts configured
    const hasWhatConverts =
      account.whatconvertsApiKey && account.whatconvertsApiSecret;

    // Additional filtering for WhatConverts accounts - only include jobs with gclid
    let jobsWithGclid = 0;
    let jobsWithoutGclid = 0;

    if (hasWhatConverts) {
      const beforeGclidCount = filteredJobs.length;
      filteredJobs = filteredJobs.filter((job) => {
        if (job.gclid) {
          jobsWithGclid++;
          return true;
        } else {
          jobsWithoutGclid++;
          console.log(`⚠️ Skipping job ${job.UUID} - no gclid found`);
          return false;
        }
      });
      console.log(
        `🔍 Filtered jobs by gclid: ${beforeGclidCount} → ${filteredJobs.length} jobs (${jobsWithGclid} with gclid, ${jobsWithoutGclid} skipped)`
      );
    } else {
      console.log(`⚠️ No WhatConverts configured, no gclid filtering applied`);
    }

    if (filteredJobs.length === 0) {
      console.log(`⚠️ No jobs match the sourceFilter criteria`);
      return res.json({
        message: `No jobs to sync for account ${account.name}`,
        details: {
          totalJobs: allJobs.length,
          filteredJobs: 0,
          sourceFilter: account.sourceFilter,
        },
      });
    }

    // Parse Google Sheets credentials
    let credentials;
    try {
      // Try to get credentials from VITE_ prefixed variable first
      const credentialsStr =
        process.env.VITE_GOOGLE_SHEETS_CREDENTIALS ||
        process.env.GOOGLE_SHEETS_CREDENTIALS;

      if (!credentialsStr) {
        throw new Error(
          "Google Sheets credentials not found in environment variables"
        );
      }

      credentials = JSON.parse(credentialsStr);
      console.log(`✅ Google Sheets credentials parsed successfully`);
    } catch (error) {
      console.error("❌ Error parsing Google Sheets credentials:", error);
      return res.status(500).json({
        error: "Invalid Google Sheets credentials format",
        details: error.message,
      });
    }

    // Initialize Google Sheets client
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });

    const sheets = google.sheets({ version: "v4", auth });
    console.log(`🔐 Google Sheets client initialized`);

    // Set headers and range based on account type
    let headers, sheetRange, columnCount;

    if (hasWhatConverts) {
      headers = [
        [
          "Google Click ID",
          "Conversion Name",
          "Conversion Time",
          "Conversion Value",
          "Conversion Currency",
        ],
      ];
      sheetRange = "Sheet1!A1:E";
      columnCount = 5;
      console.log(`📊 WhatConverts account detected - using 5-column format`);
    } else {
      headers = [
        [
          "Phone Number",
          "Call Start Time",
          "Conversion Name",
          "Conversion Time",
          "Conversion Value",
          "Conversion Currency",
        ],
      ];
      sheetRange = "Sheet1!A1:F";
      columnCount = 6;
      console.log(
        `📊 Non-WhatConverts account detected - using 6-column format`
      );
    }

    // Determine current format type
    const currentFormat = hasWhatConverts ? "whatconverts" : "standard";

    // Check if this is first time sync (no lastSheetsFormat field)
    const isFirstTimeSync = !account.lastSheetsFormat;

    // Check if we need to clear the sheet (format change only)
    // For existing accounts without lastSheetsFormat, we'll initialize it without clearing
    const shouldClearSheet =
      account.lastSheetsFormat && account.lastSheetsFormat !== currentFormat;

    if (shouldClearSheet) {
      console.log(
        `🧹 Clearing sheet - format change detected: ${account.lastSheetsFormat} → ${currentFormat}`
      );
      try {
        await RetryHandler.withRetry(
          async () => {
            // Clear the entire sheet
            await sheets.spreadsheets.values.clear({
              spreadsheetId: account.googleSheetsId,
              range: "Sheet1!A:F",
            });

            // Set the appropriate headers
            await sheets.spreadsheets.values.update({
              spreadsheetId: account.googleSheetsId,
              range: "Sheet1!A1",
              valueInputOption: "USER_ENTERED",
              requestBody: {
                values: headers,
              },
            });
          },
          3,
          1000,
          sheetsCircuitBreaker
        );
        console.log(`✅ Sheet cleared and headers set successfully`);
      } catch (error) {
        console.log(`❌ Error clearing/setting sheet: ${error.message}`);
        return res.status(500).json({
          error: "Failed to clear/set Google Sheet",
          details: error.message,
        });
      }
    } else if (isFirstTimeSync) {
      console.log(
        `🆕 First time sync - initializing format tracking without clearing sheet`
      );
    } else {
      console.log(`📋 Using existing sheet data - no clearing needed`);
    }

    // Smart row matching and updating logic
    console.log(`🔍 Starting smart row matching and updating...`);

    let updatedRows = 0;
    let newRows = 0;
    let skippedRows = 0;

    // Read existing sheet data if not clearing
    let existingData = [];
    let existingLookup = new Map();

    if (!shouldClearSheet) {
      try {
        const existingResponse = await RetryHandler.withRetry(
          async () => {
            return await sheets.spreadsheets.values.get({
              spreadsheetId: account.googleSheetsId,
              range: "Sheet1!A:F",
            });
          },
          3,
          1000,
          sheetsCircuitBreaker
        );

        existingData = existingResponse.data.values || [];
        console.log(`📋 Found ${existingData.length} existing rows in sheet`);

        // Create lookup map for existing data (skip header row)
        if (existingData.length > 1) {
          for (let i = 1; i < existingData.length; i++) {
            const row = existingData[i];
            const key = row[0]; // First column (gclid or phone number)
            if (key) {
              existingLookup.set(key, i + 1); // +1 because sheet rows are 1-indexed
            }
          }
          console.log(
            `🔍 Created lookup map with ${existingLookup.size} entries`
          );
        }
      } catch (error) {
        console.log(`⚠️ Error reading existing data: ${error.message}`);
        // Continue with empty lookup - will treat all as new rows
      }
    }

    // Process each job for smart updating
    const batchSize = 100;
    const updateBatches = [];
    const appendBatches = [];

    for (const job of filteredJobs) {
      // Helper function to format date in account timezone
      const formatDateInAccountTimezone = (dateString, fallbackDateString = null) => {
        try {
          const dateToUse = dateString || fallbackDateString || job.JobDateTime;
          if (!dateToUse) {
            console.warn(`⚠️ No valid date found for job ${job.UUID}`);
            return "";
          }
          
          return formatInTimeZone(
            new Date(dateToUse),
            account.timezone || "America/Los_Angeles",
            "yyyy-MM-dd'T'HH:mm:ss"
          ) + ` ${account.timezone || "America/Los_Angeles"}`;
        } catch (error) {
          console.error(`❌ Error formatting date for job ${job.UUID}:`, error);
          return "";
        }
      };

      // Format dates in account timezone
      const callStartTime = formatDateInAccountTimezone(job.CreatedDate);
      const conversionTime = formatDateInAccountTimezone(job.LastStatusUpdate, job.CreatedDate);

      // Conversion value logic
      let conversionValue = account.defaultConversionValue || 0;
      if (job.JobTotalPrice && job.JobTotalPrice !== 0) {
        conversionValue = job.JobTotalPrice;
      }
      if (
        job.Status &&
        ["Cancelled", "Canceled", "cancelled", "CANCELLED"].includes(job.Status)
      ) {
        conversionValue = 0;
      }

      // Create row data based on format
      let rowData;
      let matchKey;

      if (hasWhatConverts) {
        rowData = [
          job.gclid || "", // Google Click ID
          "Google Ads Convert", // Conversion Name
          conversionTime, // Conversion Time (LastStatusUpdate in account timezone)
          conversionValue, // Conversion Value
          "USD", // Conversion Currency
        ];
        matchKey = job.gclid;
      } else {
        rowData = [
          job.Phone || "", // Phone Number
          callStartTime, // Call Start Time (CreatedDate in account timezone)
          "Google Ads Convert", // Conversion Name
          conversionTime, // Conversion Time (LastStatusUpdate in account timezone)
          conversionValue, // Conversion Value
          "USD", // Conversion Currency
        ];
        matchKey = job.Phone;
      }

      // Check if row exists
      if (matchKey && existingLookup.has(matchKey)) {
        // Update existing row
        const rowNumber = existingLookup.get(matchKey);
        updateBatches.push({
          range: `Sheet1!A${rowNumber}:${String.fromCharCode(
            65 + columnCount - 1
          )}${rowNumber}`,
          values: [rowData],
        });
        updatedRows++;
      } else if (matchKey) {
        // Add new row
        appendBatches.push(rowData);
        newRows++;
      } else {
        // Skip rows without match key
        skippedRows++;
      }
    }

    // Log date field statistics
    const dateFieldStats = {
      jobsWithCreatedDate: filteredJobs.filter(j => j.CreatedDate).length,
      jobsWithLastStatusUpdate: filteredJobs.filter(j => j.LastStatusUpdate).length,
      jobsWithBothDates: filteredJobs.filter(j => j.CreatedDate && j.LastStatusUpdate).length,
      jobsWithFallbackDates: filteredJobs.filter(j => !j.CreatedDate || !j.LastStatusUpdate).length,
    };
    
    console.log(`📅 Date field statistics:`);
    console.log(`   - Jobs with CreatedDate: ${dateFieldStats.jobsWithCreatedDate}/${filteredJobs.length}`);
    console.log(`   - Jobs with LastStatusUpdate: ${dateFieldStats.jobsWithLastStatusUpdate}/${filteredJobs.length}`);
    console.log(`   - Jobs with both dates: ${dateFieldStats.jobsWithBothDates}/${filteredJobs.length}`);
    console.log(`   - Jobs using fallback dates: ${dateFieldStats.jobsWithFallbackDates}/${filteredJobs.length}`);
    console.log(`   - Account timezone: ${account.timezone || 'America/Los_Angeles'}`);

    console.log(
      `📊 Processing summary: ${updatedRows} updates, ${newRows} new rows, ${skippedRows} skipped`
    );

    // Execute updates in batches
    if (updateBatches.length > 0) {
      console.log(`🔄 Updating ${updateBatches.length} existing rows...`);
      for (let i = 0; i < updateBatches.length; i += batchSize) {
        const batch = updateBatches.slice(i, i + batchSize);
        await RetryHandler.withRetry(
          async () => {
            const batchUpdate = {
              spreadsheetId: account.googleSheetsId,
              requestBody: {
                valueInputOption: "USER_ENTERED",
                data: batch,
              },
            };
            return await sheets.spreadsheets.values.batchUpdate(batchUpdate);
          },
          3,
          1000,
          sheetsCircuitBreaker
        );
      }
      console.log(`✅ Updated ${updateBatches.length} existing rows`);
    }

    // Execute appends in batches
    if (appendBatches.length > 0) {
      console.log(`📤 Appending ${appendBatches.length} new rows...`);
      for (let i = 0; i < appendBatches.length; i += batchSize) {
        const batch = appendBatches.slice(i, i + batchSize);
        await RetryHandler.withRetry(
          async () => {
            return await sheets.spreadsheets.values.append({
              spreadsheetId: account.googleSheetsId,
              range: `Sheet1!A2:${String.fromCharCode(65 + columnCount - 1)}2`,
              valueInputOption: "USER_ENTERED",
              requestBody: {
                values: batch,
              },
            });
          },
          3,
          1000,
          sheetsCircuitBreaker
        );
      }
      console.log(`✅ Appended ${appendBatches.length} new rows`);
    }

    const totalProcessed = updatedRows + newRows;
    console.log(`✅ Google Sheets sync completed successfully`);
    console.log(
      `📈 Total processed: ${totalProcessed} rows (${updatedRows} updated, ${newRows} new)`
    );

    // Record sync history
    const syncHistoryRecord = {
      accountId: account._id || account.id,
      syncType: "sheets",
      status: "success",
      timestamp: new Date(),
      duration: Date.now() - accountStartTime,
      details: {
        totalJobs: allJobs.length,
        filteredJobs: filteredJobs.length,
        updatedRows: updatedRows,
        newRows: newRows,
        skippedRows: skippedRows,
        totalProcessed: totalProcessed,
        sourceFilter: account.sourceFilter,
        sampleJobSources: [
          ...new Set(filteredJobs.slice(0, 5).map((job) => job.JobSource)),
        ],
        syncMethod: "manual",
        formatType: hasWhatConverts ? "whatconverts" : "standard",
        columnCount: columnCount,
        sheetCleared: shouldClearSheet,
        isFirstTimeSync: isFirstTimeSync,
        previousFormat: account.lastSheetsFormat,
        currentFormat: currentFormat,
        dateFilter: {
          enabled: true,
          daysBack: 30,
          cutoffDate: thirtyDaysAgo.toISOString(),
        },
        whatconvertsStats: hasWhatConverts
          ? {
              jobsWithGclid: jobsWithGclid,
              jobsWithoutGclid: jobsWithoutGclid,
            }
          : null,
        jobStatusBreakdown: {
          submitted: filteredJobs.filter((j) => j.Status === "Submitted")
            .length,
          pending: filteredJobs.filter((j) => j.Status === "Pending").length,
          completed: filteredJobs.filter(
            (j) =>
              j.Status === "Completed" || j.Status === "done pending approval"
          ).length,
          cancelled: filteredJobs.filter((j) =>
            ["Cancelled", "Canceled", "cancelled", "CANCELLED"].includes(
              j.Status
            )
          ).length,
        },
        conversionValueLogic: {
          defaultValue: account.defaultConversionValue || 0,
          jobsWithJobTotalPrice: filteredJobs.filter(
            (j) => j.JobTotalPrice && j.JobTotalPrice !== 0
          ).length,
          jobsWithCancelledStatus: filteredJobs.filter((j) =>
            ["Cancelled", "Canceled", "cancelled", "CANCELLED"].includes(
              j.Status
            )
          ).length,
        },
        dateFieldStatistics: {
          jobsWithCreatedDate: dateFieldStats.jobsWithCreatedDate,
          jobsWithLastStatusUpdate: dateFieldStats.jobsWithLastStatusUpdate,
          jobsWithBothDates: dateFieldStats.jobsWithBothDates,
          jobsWithFallbackDates: dateFieldStats.jobsWithFallbackDates,
          accountTimezone: account.timezone || 'America/Los_Angeles',
        },
      },
    };

    await RetryHandler.withRetry(async () => {
      await db.collection("syncHistory").insertOne(syncHistoryRecord);
    });

    const accountDuration = Date.now() - accountStartTime;
    console.log(
      `📊 Google Sheets sync summary for ${account.name} (${accountDuration}ms):`
    );
    console.log(`   - Date filter: Last 30 days (since ${thirtyDaysAgo.toISOString()})`);
    console.log(`   - Total jobs: ${allJobs.length}`);
    console.log(`   - Filtered jobs: ${filteredJobs.length}`);
    console.log(`   - Updated rows: ${updatedRows}`);
    console.log(`   - New rows: ${newRows}`);
    console.log(`   - Skipped rows: ${skippedRows}`);
    console.log(`   - Sheet cleared: ${shouldClearSheet ? "Yes" : "No"}`);
    if (
      account.lastSheetsFormat &&
      account.lastSheetsFormat !== currentFormat
    ) {
      console.log(
        `   - Format changed: ${account.lastSheetsFormat} → ${currentFormat}`
      );
    }

    // Update account's lastSyncDate and format tracking
    await RetryHandler.withRetry(async () => {
      await db.collection("accounts").updateOne(
        { _id: account._id || new ObjectId(account.id) },
        {
          $set: {
            lastSyncDate: new Date(),
            lastSheetsFormat: currentFormat,
          },
        }
      );
    });

    res.json({
      message: `Synced ${totalProcessed} jobs to Google Sheets for account ${account.name}`,
      details: {
        totalJobs: allJobs.length,
        filteredJobs: filteredJobs.length,
        updatedRows: updatedRows,
        newRows: newRows,
        skippedRows: skippedRows,
        totalProcessed: totalProcessed,
        sourceFilter: account.sourceFilter,
        formatType: hasWhatConverts ? "whatconverts" : "standard",
        columnCount: columnCount,
        sheetCleared: shouldClearSheet,
        isFirstTimeSync: isFirstTimeSync,
        previousFormat: account.lastSheetsFormat,
        currentFormat: currentFormat,
        dateFilter: {
          enabled: true,
          daysBack: 30,
          cutoffDate: thirtyDaysAgo.toISOString(),
        },
        sampleJobSources: [
          ...new Set(filteredJobs.slice(0, 5).map((job) => job.JobSource)),
        ],
        syncMethod: "manual",
        whatconvertsStats: hasWhatConverts
          ? {
              jobsWithGclid: jobsWithGclid,
              jobsWithoutGclid: jobsWithoutGclid,
            }
          : null,
        jobStatusBreakdown: {
          submitted: filteredJobs.filter((j) => j.Status === "Submitted")
            .length,
          pending: filteredJobs.filter((j) => j.Status === "Pending").length,
          completed: filteredJobs.filter(
            (j) =>
              j.Status === "Completed" || j.Status === "done pending approval"
          ).length,
          cancelled: filteredJobs.filter((j) =>
            ["Cancelled", "Canceled", "cancelled", "CANCELLED"].includes(
              j.Status
            )
          ).length,
        },
        conversionValueLogic: {
          defaultValue: account.defaultConversionValue || 0,
          jobsWithJobTotalPrice: filteredJobs.filter(
            (j) => j.JobTotalPrice && j.JobTotalPrice !== 0
          ).length,
          jobsWithCancelledStatus: filteredJobs.filter((j) =>
            ["Cancelled", "Canceled", "cancelled", "CANCELLED"].includes(
              j.Status
            )
          ).length,
        },
        dateFieldStatistics: {
          jobsWithCreatedDate: dateFieldStats.jobsWithCreatedDate,
          jobsWithLastStatusUpdate: dateFieldStats.jobsWithLastStatusUpdate,
          jobsWithBothDates: dateFieldStats.jobsWithBothDates,
          jobsWithFallbackDates: dateFieldStats.jobsWithFallbackDates,
          accountTimezone: account.timezone || 'America/Los_Angeles',
        },
      },
    });
  } catch (error) {
    console.error("❌ Error syncing to Google Sheets:", error);

    // Record failed sync history if we have account info
    if (req.params.accountId) {
      try {
        const syncHistoryRecord = {
          accountId: req.params.accountId,
          syncType: "sheets",
          status: "error",
          timestamp: new Date(),
          duration: Date.now() - accountStartTime,
          errorMessage: error.message,
          details: {},
        };
        await db.collection("syncHistory").insertOne(syncHistoryRecord);
        console.log(`📝 Failed sync history recorded for sheets sync`);
      } catch (historyError) {
        console.log(
          `❌ Failed to record sync history: ${historyError.message}`
        );
      }
    }

    res.status(500).json({
      error: error.message,
      details: error.response?.data || "Unknown error occurred",
    });
  }
});

// Batch continuation processing function (can be called directly)
async function processBatchContinuation(accountId, functionStartTime) {
  const db = await ensureDbConnection();
  console.log(`🔄 Continuing batch processing for account ID: ${accountId}`);

  // Find account by ID - try both id and _id fields
  const account = await db.collection("accounts").findOne({
    $or: [{ _id: new ObjectId(accountId) }, { id: accountId }],
  });

  if (!account) {
    console.log(`❌ Account not found for ID: ${accountId}`);
    throw new Error("Account not found");
  }

  // Get current batch state
  const batchState = await BatchProcessingManager.getBatchState(db, accountId);

  if (!batchState) {
    throw new Error("No active batch processing found");
  }

  console.log(`🔄 Continuing batch processing for account ${account.name}`);
  console.log(
    `📊 Current progress: ${batchState.currentBatch}/${batchState.totalBatches} batches`
  );

  // Calculate 50-day cutoff date for job updates
  const fiftyDaysAgo = new Date();
  fiftyDaysAgo.setDate(fiftyDaysAgo.getDate() - 50);

  // Get jobs for current batch (only jobs from last 50 days)
  const BATCH_SIZE = 29;
  const startIndex = batchState.currentBatch * BATCH_SIZE;
  const existingJobs = await db
    .collection("jobs")
    .find({
      accountId: account._id || account.id,
      JobDateTime: { $gte: fiftyDaysAgo.toISOString() },
    })
    .skip(startIndex)
    .limit(BATCH_SIZE)
    .toArray();

  if (existingJobs.length === 0) {
    // No more jobs to process, complete the batch state
    await BatchProcessingManager.completeBatchState(db, accountId, {
      processedJobs: batchState.processedJobs,
      updatedJobs: batchState.updatedJobs,
      deletedJobs: batchState.deletedJobs,
      failedUpdates: batchState.failedUpdates,
    });

    return {
      message: `Job update and cleanup completed for account ${account.name}`,
      details: {
        totalJobsProcessed: batchState.processedJobs,
        jobsUpdated: batchState.updatedJobs,
        jobsDeleted: batchState.deletedJobs,
        failedUpdates: batchState.failedUpdates,
        duration: Date.now() - functionStartTime,
        processingMethod: "hybrid-batch-continuation",
        cutoffDate: fiftyDaysAgo.toISOString().split("T")[0],
      },
    };
  }

  // Calculate 1-year cutoff date
  const oneYearAgo = new Date();
  oneYearAgo.setDate(oneYearAgo.getDate() - 365);

  console.log(
    `📦 Processing batch ${batchState.currentBatch + 1}/${
      batchState.totalBatches
    } (${existingJobs.length} jobs)`
  );
  console.log(
    `📅 Only updating jobs from last 50 days (since ${
      fiftyDaysAgo.toISOString().split("T")[0]
    })`
  );

  const batchStartTime = Date.now();
  let batchUpdatedJobs = 0;
  let batchDeletedJobs = 0;
  let batchFailedUpdates = 0;

  // Process each job in the current batch
  for (const existingJob of existingJobs) {
    try {
      const jobDate = new Date(existingJob.JobDateTime);

      // Check if job is older than 1 year
      if (jobDate < oneYearAgo) {
        console.log(
          `🗑️ Deleting old job: ${existingJob.UUID} (${existingJob.JobDateTime})`
        );
        await RetryHandler.withRetry(async () => {
          await db.collection("jobs").deleteOne({ UUID: existingJob.UUID });
        });
        batchDeletedJobs++;
        continue;
      }

      // Update job using Workiz API
      const updateUrl = `https://api.workiz.com/api/v1/${account.workizApiToken}/job/get/${existingJob.UUID}/`;

      const updateResponse = await RetryHandler.withRetry(
        async () => {
          const resp = await APIManager.fetchWithTimeout(updateUrl, {}, 30000);

          if (!resp.ok) {
            const errorText = await resp.text();
            console.log(`❌ Job update error: ${resp.status} - ${errorText}`);

            if (
              errorText.includes('<div class="text-container">') ||
              errorText.includes("Oops!") ||
              errorText.includes("Something went wrong")
            ) {
              throw new Error(
                `Workiz API 520 error - server is experiencing issues`
              );
            }

            throw new Error(`Job update error: ${resp.status} - ${errorText}`);
          }

          return resp;
        },
        3,
        1000,
        workizCircuitBreaker
      );

      const updateData = await updateResponse.json();

      if (updateData.flag && updateData.data && updateData.data.length > 0) {
        const jobData = updateData.data[0];
        const updatedJob = {
          ...jobData,
          accountId: account._id || account.id,
        };

        await RetryHandler.withRetry(async () => {
          await db
            .collection("jobs")
            .updateOne(
              { UUID: existingJob.UUID },
              { $set: updatedJob },
              { upsert: true }
            );
        });

        batchUpdatedJobs++;
      } else {
        console.log(`⚠️ Job not found in Workiz API: ${existingJob.UUID}`);
        await RetryHandler.withRetry(async () => {
          await db.collection("jobs").deleteOne({ UUID: existingJob.UUID });
        });
        batchDeletedJobs++;
      }

      // Add a delay between individual job updates (5000ms)
      await new Promise((resolve) => setTimeout(resolve, 5000));
    } catch (error) {
      if (error.message.includes("Circuit breaker is OPEN")) {
        console.log(
          `🚨 Circuit breaker blocked job update for ${existingJob.UUID}`
        );
        continue;
      }

      console.log(
        `❌ Error processing job ${existingJob.UUID}: ${error.message}`
      );
      batchFailedUpdates++;
    }
  }

  // Update batch state with current batch results
  const updatedStats = {
    currentBatch: batchState.currentBatch + 1,
    processedJobs: batchState.processedJobs + existingJobs.length,
    updatedJobs: batchState.updatedJobs + batchUpdatedJobs,
    deletedJobs: batchState.deletedJobs + batchDeletedJobs,
    failedUpdates: batchState.failedUpdates + batchFailedUpdates,
    lastBatchTime: new Date(),
  };

  await BatchProcessingManager.updateBatchState(db, accountId, updatedStats);

  const batchDuration = Date.now() - batchStartTime;
  console.log(
    `📊 Batch ${
      batchState.currentBatch + 1
    } completed in ${batchDuration}ms: ${batchUpdatedJobs} updated, ${batchDeletedJobs} deleted, ${batchFailedUpdates} failed`
  );

  // Check if this was the last batch
  if (updatedStats.currentBatch >= batchState.totalBatches) {
    // Complete the batch processing
    await BatchProcessingManager.completeBatchState(db, accountId, {
      processedJobs: updatedStats.processedJobs,
      updatedJobs: updatedStats.updatedJobs,
      deletedJobs: updatedStats.deletedJobs,
      failedUpdates: updatedStats.failedUpdates,
    });

    // Record sync history
    const syncHistoryRecord = {
      accountId: account._id || account.id,
      syncType: "update-cleanup",
      status: "success",
      timestamp: new Date(),
      duration: Date.now() - functionStartTime,
      details: {
        totalJobsProcessed: updatedStats.processedJobs,
        jobsUpdated: updatedStats.updatedJobs,
        jobsDeleted: updatedStats.deletedJobs,
        failedUpdates: updatedStats.failedUpdates,
        syncMethod: "hybrid-batch-continuation",
        totalBatches: batchState.totalBatches,
      },
    };

    await RetryHandler.withRetry(async () => {
      await db.collection("syncHistory").insertOne(syncHistoryRecord);
    });

    // Update account's lastUpdateCleanupDate
    await RetryHandler.withRetry(async () => {
      await db
        .collection("accounts")
        .updateOne(
          { _id: account._id || new ObjectId(account.id) },
          { $set: { lastUpdateCleanupDate: new Date() } }
        );
    });

    return {
      message: `Job update and cleanup completed for account ${account.name}`,
      details: {
        totalJobsProcessed: updatedStats.processedJobs,
        jobsUpdated: updatedStats.updatedJobs,
        jobsDeleted: updatedStats.deletedJobs,
        failedUpdates: updatedStats.failedUpdates,
        duration: Date.now() - functionStartTime,
        processingMethod: "hybrid-batch-continuation",
        totalBatches: batchState.totalBatches,
      },
    };
  }

  // Always schedule next batch via cron (no more recursive calls)
  const nextBatchTime = new Date(Date.now() + 5 * 60 * 1000);
  await BatchProcessingManager.scheduleNextBatch(db, accountId, nextBatchTime);

  console.log(
    `⏰ Scheduled next batch for ${nextBatchTime.toISOString()} (cron scheduling)`
  );

  return {
    message: `Batch ${
      batchState.currentBatch + 1
    } completed, next batch scheduled`,
    details: {
      currentBatch: batchState.currentBatch + 1,
      totalBatches: batchState.totalBatches,
      progress: `${Math.round(
        ((batchState.currentBatch + 1) / batchState.totalBatches) * 100
      )}%`,
      batchResults: {
        jobsProcessed: existingJobs.length,
        jobsUpdated: batchUpdatedJobs,
        jobsDeleted: batchDeletedJobs,
        failedUpdates: batchFailedUpdates,
      },
      totalProgress: {
        processedJobs: updatedStats.processedJobs,
        updatedJobs: updatedStats.updatedJobs,
        deletedJobs: updatedStats.deletedJobs,
        failedUpdates: updatedStats.failedUpdates,
      },
      nextBatchTime: nextBatchTime.toISOString(),
      processingMethod: "cron-scheduled",
      duration: Date.now() - functionStartTime,
    },
  };
}

// Continuation endpoint for batch processing (HTTP endpoint)
app.post("/api/continue-update-cleanup/:accountId", async (req, res) => {
  const functionStartTime = Date.now();

  try {
    const result = await processBatchContinuation(
      req.params.accountId,
      functionStartTime
    );
    res.json(result);
  } catch (error) {
    console.log(`❌ Continue batch processing error: ${error.message}`);
    console.log(`❌ Error stack: ${error.stack}`);
    console.log(`❌ Account ID: ${req.params.accountId}`);

    // Record failed sync history if we have account info
    if (req.params.accountId) {
      try {
        const db = await ensureDbConnection();
        const syncHistoryRecord = {
          accountId: req.params.accountId,
          syncType: "update-cleanup",
          status: "error",
          timestamp: new Date(),
          duration: Date.now() - functionStartTime,
          errorMessage: error.message,
          details: {
            processingMethod: "hybrid-batch-continuation",
            errorStack: error.stack,
          },
        };
        await db.collection("syncHistory").insertOne(syncHistoryRecord);
        console.log(`📝 Failed sync history recorded for batch continuation`);
      } catch (historyError) {
        console.log(
          `❌ Failed to record sync history: ${historyError.message}`
        );
      }
    }

    res.status(500).json({
      error: error.message,
      details: {
        accountId: req.params.accountId,
        timestamp: new Date().toISOString(),
        processingMethod: "hybrid-batch-continuation",
      },
    });
  }
});

// Manual trigger endpoint for testing cron functionality
app.post("/api/trigger-sync/:accountId", async (req, res) => {
  try {
    const { accountId } = req.params;
    console.log(`🔧 Manual sync trigger for account ID: ${accountId}`);

    // Find account
    const account = await db.collection("accounts").findOne({
      $or: [{ _id: new ObjectId(accountId) }, { id: accountId }],
    });

    if (!account) {
      return res.status(404).json({ error: "Account not found" });
    }

    console.log(`⏰ Manual sync for account: ${account.name}`);

    // Sync jobs
    try {
      // Calculate start_date as 2 months before current date
      const startDate = new Date();
      startDate.setMonth(startDate.getMonth() - 2);
      const startDateStr = startDate.toISOString().split("T")[0]; // Format as YYYY-MM-DD

      const workizUrl = `https://api.workiz.com/api/v1/${account.workizApiToken}/job/all/?start_date=${startDateStr}&offset=0&records=100&only_open=false`;
      const response = await fetch(workizUrl);

      if (!response.ok) {
        throw new Error(`Workiz API error: ${response.status}`);
      }

      const data = await response.json();
      if (!data.flag || !Array.isArray(data.data)) {
        throw new Error("Invalid response from Workiz API");
      }

      // Add accountId to each job
      const jobs = data.data.map((job) => ({
        ...job,
        accountId: account._id || account.id,
      }));

      // Upsert jobs into MongoDB
      const bulkOps = jobs.map((job) => ({
        updateOne: {
          filter: { UUID: job.UUID },
          update: { $set: job },
          upsert: true,
        },
      }));

      if (bulkOps.length > 0) {
        const bulkResult = await db.collection("jobs").bulkWrite(bulkOps);
        console.log(
          `✅ Jobs sync completed: ${bulkResult.upsertedCount} new, ${bulkResult.modifiedCount} updated`
        );
      }

      // Record sync history
      const syncHistoryRecord = {
        accountId: account._id || account.id,
        syncType: "jobs",
        status: "success",
        timestamp: new Date(),
        duration: Date.now() - accountStartTime,
        details: {
          jobsFromWorkiz: jobs.length,
          finalJobCount: await db
            .collection("jobs")
            .countDocuments({ accountId: account._id || account.id }),
          syncMethod: "manual",
          jobStatusBreakdown: {
            submitted: jobs.filter((j) => j.Status === "Submitted").length,
            pending: jobs.filter((j) => j.Status === "Pending").length,
            completed: jobs.filter(
              (j) =>
                j.Status === "Completed" || j.Status === "done pending approval"
            ).length,
            cancelled: jobs.filter((j) =>
              ["Cancelled", "Canceled", "cancelled", "CANCELLED"].includes(
                j.Status
              )
            ).length,
          },
        },
      };

      await RetryHandler.withRetry(async () => {
        await db.collection("syncHistory").insertOne(syncHistoryRecord);
      });

      // Update account's lastSyncDate
      await RetryHandler.withRetry(async () => {
        await db
          .collection("accounts")
          .updateOne(
            { _id: account._id || new ObjectId(account.id) },
            { $set: { lastSyncDate: new Date() } }
          );
      });

      res.json({
        message: `Manual sync completed for account ${account.name}`,
        jobsSync: {
          success: true,
          jobsSynced: jobs.length,
        },
      });
    } catch (error) {
      console.error(
        `❌ Manual sync failed for account ${account.name}:`,
        error.message
      );

      // Record failed sync history
      const syncHistoryRecord = {
        accountId: account._id || account.id,
        syncType: "jobs",
        status: "error",
        timestamp: new Date(),
        duration: Date.now() - accountStartTime,
        errorMessage: error.message,
        details: {},
      };
      await RetryHandler.withRetry(async () => {
        await db.collection("syncHistory").insertOne(syncHistoryRecord);
      });

      res.status(500).json({
        error: error.message,
        jobsSync: { success: false, error: error.message },
      });
    }
  } catch (error) {
    console.error("❌ Manual trigger failed:", error);
    res.status(500).json({ error: error.message });
  }
});

// Individual cron job endpoints for accounts 1-10
for (let i = 1; i <= 10; i++) {
  app.get(`/api/cron/sync-jobs/account${i}`, async (req, res) => {
    try {
      // Enhanced security validation
      const userAgent = req.get("User-Agent");
      const clientIP = req.ip || req.connection.remoteAddress;

      if (!userAgent || !userAgent.includes("vercel-cron")) {
        console.log(`❌ Unauthorized cron access attempt:`, {
          userAgent,
          clientIP,
          timestamp: new Date().toISOString(),
        });
        return res.status(403).json({
          error: "Unauthorized",
          timestamp: new Date().toISOString(),
        });
      }

      console.log(
        `🕐 Vercel Cron Job for account${i} triggered at: ${new Date().toISOString()}`
      );

      // Ensure database connection
      const db = await ensureDbConnection();
      await DatabaseManager.ensureHealthyConnection(db);

      // Get the specific account by index (1-based)
      const accounts = await RetryHandler.withRetry(async () => {
        const result = await db.collection("accounts").find({}).toArray();
        return result;
      });

      if (accounts.length === 0) {
        console.log("📭 No accounts found");
        return res.json({
          message: "No accounts found",
          accountIndex: i,
        });
      }

      // Get account at index i-1 (0-based)
      const accountIndex = i - 1;
      if (accountIndex >= accounts.length) {
        console.log(
          `📭 No account at index ${i} (only ${accounts.length} accounts exist)`
        );
        return res.json({
          message: `No account at index ${i}`,
          accountIndex: i,
          totalAccounts: accounts.length,
        });
      }

      const account = accounts[accountIndex];
      console.log(`📋 Processing account ${i}: ${account.name}`);

      // Call the existing sync-jobs endpoint logic for this account
      const accountStartTime = Date.now();

      try {
        if (!account.workizApiToken) {
          throw new Error("Missing API token for this account");
        }

        // Calculate start_date as 2 months before current date
        const startDate = new Date();
        startDate.setMonth(startDate.getMonth() - 2);
        const startDateStr = startDate.toISOString().split("T")[0]; // Format as YYYY-MM-DD

        // Fetch jobs from Workiz API
        const workizUrl = `https://api.workiz.com/api/v1/${account.workizApiToken}/job/all/?start_date=${startDateStr}&offset=0&records=100&only_open=false`;
        console.log(`🌐 Fetching from Workiz: ${workizUrl}`);

        const response = await RetryHandler.withRetry(
          async () => {
            const resp = await APIManager.fetchWithTimeout(
              workizUrl,
              {},
              45000
            );

            if (!resp.ok) {
              const errorText = await resp.text();
              console.log(`❌ Workiz API error: ${resp.status} - ${errorText}`);

              if (
                errorText.includes('<div class="text-container">') ||
                errorText.includes("Oops!") ||
                errorText.includes("Something went wrong")
              ) {
                throw new Error(
                  `Workiz API 520 error - server is experiencing issues`
                );
              }

              throw new Error(
                `Workiz API error: ${resp.status} - ${errorText}`
              );
            }

            return resp;
          },
          5,
          2000,
          workizCircuitBreaker
        );

        const data = await response.json();
        console.log(
          `📊 Workiz API response: flag=${data.flag}, data.length=${
            data.data?.length || 0
          }`
        );

        if (!data.flag || !Array.isArray(data.data)) {
          throw new Error("Invalid response from Workiz API");
        }

        console.log(`📋 Processing ${data.data.length} jobs from Workiz`);

        // Add accountId to each job
        const allJobs = data.data.map((job) => ({
          ...job,
          accountId: account._id || account.id,
        }));

        // Filter jobs by sourceFilter if configured
        let filteredJobs = allJobs;
        if (
          account.sourceFilter &&
          Array.isArray(account.sourceFilter) &&
          account.sourceFilter.length > 0
        ) {
          filteredJobs = allJobs.filter((job) =>
            account.sourceFilter.includes(job.JobSource)
          );
          console.log(
            `🔍 Filtered jobs by sourceFilter: ${allJobs.length} → ${filteredJobs.length} jobs`
          );
        } else {
          console.log(
            `⚠️ No sourceFilter configured, using all ${allJobs.length} jobs`
          );
        }

        // Additional filtering by WhatConverts if API key and secret are configured
        if (
          account.whatconvertsApiKey &&
          account.whatconvertsApiSecret &&
          filteredJobs.length > 0
        ) {
          console.log(
            `🔍 WhatConverts API credentials found, checking phone numbers...`
          );

          const phoneNumbers = [
            ...new Set(
              filteredJobs
                .map((job) => job.Phone)
                .filter((phone) => phone && phone.trim() !== "")
            ),
          ];

          console.log(
            `📞 Checking ${phoneNumbers.length} unique phone numbers in WhatConverts`
          );

          const whatconvertsResults =
            await WhatConvertsAPI.checkMultiplePhonesInLeads(
              account.whatconvertsApiKey,
              account.whatconvertsApiSecret,
              phoneNumbers
            );

          const beforeWhatconvertsCount = filteredJobs.length;
          let jobsWithGclid = 0;

          filteredJobs = filteredJobs.filter((job) => {
            if (!job.Phone || job.Phone.trim() === "") {
              return false;
            }

            const leadData = whatconvertsResults[job.Phone];
            if (!leadData || !leadData.exists) {
              return false;
            }

            if (!leadData.hasGclid) {
              return false;
            }

            job.gclid = leadData.gclid;
            job.whatconvertsDateCreated = leadData.dateCreated;
            jobsWithGclid++;

            return true;
          });

          console.log(
            `🔍 Filtered jobs by WhatConverts: ${beforeWhatconvertsCount} → ${filteredJobs.length} jobs (${jobsWithGclid} with gclid)`
          );
        }

        if (filteredJobs.length === 0) {
          console.log(`⚠️ No jobs match the filtering criteria`);
          return res.json({
            message: `No jobs match the filtering criteria for account ${account.name}`,
            accountIndex: i,
            accountName: account.name,
            details: {
              jobsFromWorkiz: allJobs.length,
              filteredJobs: 0,
              sourceFilter: account.sourceFilter,
              whatconvertsEnabled: !!(
                account.whatconvertsApiKey && account.whatconvertsApiSecret
              ),
            },
          });
        }

        // Upsert filtered jobs into MongoDB
        const bulkOps = filteredJobs.map((job) => ({
          updateOne: {
            filter: { UUID: job.UUID },
            update: { $set: job },
            upsert: true,
          },
        }));

        if (bulkOps.length > 0) {
          const bulkResult = await db.collection("jobs").bulkWrite(bulkOps);
          console.log(`✅ Bulk write completed:`, {
            matchedCount: bulkResult.matchedCount,
            modifiedCount: bulkResult.modifiedCount,
            upsertedCount: bulkResult.upsertedCount,
          });
        }

        // Verify final count
        const finalJobCount = await db.collection("jobs").countDocuments({
          accountId: account._id || account.id,
        });

        // Record sync history
        const syncHistoryRecord = {
          accountId: account._id || account.id,
          syncType: "jobs",
          status: "success",
          timestamp: new Date(),
          duration: Date.now() - accountStartTime,
          details: {
            jobsFromWorkiz: allJobs.length,
            filteredJobs: filteredJobs.length,
            finalJobCount: finalJobCount,
            sourceFilter: account.sourceFilter,
            whatconvertsEnabled: !!(
              account.whatconvertsApiKey && account.whatconvertsApiSecret
            ),
            syncMethod: "cron",
            cronJobIndex: i,
          },
        };

        await RetryHandler.withRetry(async () => {
          await db.collection("syncHistory").insertOne(syncHistoryRecord);
        });

        // Update account's lastSyncDate
        await RetryHandler.withRetry(async () => {
          await db
            .collection("accounts")
            .updateOne(
              { _id: account._id || new ObjectId(account.id) },
              { $set: { lastSyncDate: new Date() } }
            );
        });

        const duration = Date.now() - accountStartTime;
        console.log(
          `✅ Cron job for account${i} (${account.name}) completed in ${duration}ms`
        );

        res.json({
          message: `Synced ${filteredJobs.length} jobs for account ${account.name}`,
          accountIndex: i,
          accountName: account.name,
          duration: duration,
          details: {
            jobsFromWorkiz: allJobs.length,
            filteredJobs: filteredJobs.length,
            finalJobCount: finalJobCount,
            sourceFilter: account.sourceFilter,
            whatconvertsEnabled: !!(
              account.whatconvertsApiKey && account.whatconvertsApiSecret
            ),
          },
        });
      } catch (error) {
        console.log(`❌ Cron job for account${i} failed: ${error.message}`);

        // Record failed sync history
        const syncHistoryRecord = {
          accountId: account._id || account.id,
          syncType: "jobs",
          status: "error",
          timestamp: new Date(),
          duration: Date.now() - accountStartTime,
          errorMessage: error.message,
          details: {
            cronJobIndex: i,
          },
        };

        try {
          await db.collection("syncHistory").insertOne(syncHistoryRecord);
        } catch (historyError) {
          console.log(
            `❌ Failed to record sync history: ${historyError.message}`
          );
        }

        res.status(500).json({
          error: error.message,
          accountIndex: i,
          accountName: account.name,
          duration: Date.now() - accountStartTime,
        });
      }
    } catch (error) {
      console.log(`❌ Cron job for account${i} error: ${error.message}`);
      res.status(500).json({
        error: error.message,
        accountIndex: i,
        timestamp: new Date().toISOString(),
      });
    }
  });
}

// Batch cron job for accounts 11+
app.get("/api/cron/sync-jobs/batch", async (req, res) => {
  try {
    // Enhanced security validation
    const userAgent = req.get("User-Agent");
    const clientIP = req.ip || req.connection.remoteAddress;

    if (!userAgent || !userAgent.includes("vercel-cron")) {
      console.log(`❌ Unauthorized cron access attempt:`, {
        userAgent,
        clientIP,
        timestamp: new Date().toISOString(),
      });
      return res.status(403).json({
        error: "Unauthorized",
        timestamp: new Date().toISOString(),
      });
    }

    console.log(
      `🕐 Vercel Cron Job for batch accounts triggered at: ${new Date().toISOString()}`
    );

    // Ensure database connection
    const db = await ensureDbConnection();
    await DatabaseManager.ensureHealthyConnection(db);

    // Get all accounts
    const accounts = await RetryHandler.withRetry(async () => {
      const result = await db.collection("accounts").find({}).toArray();
      return result;
    });

    if (accounts.length === 0) {
      console.log("📭 No accounts found");
      return res.json({
        message: "No accounts found",
        batchType: "overflow",
      });
    }

    // Process only accounts 11 and beyond (index 10+)
    const batchAccounts = accounts.slice(10);

    if (batchAccounts.length === 0) {
      console.log("📭 No overflow accounts found (accounts 11+)");
      return res.json({
        message: "No overflow accounts found",
        batchType: "overflow",
        totalAccounts: accounts.length,
        batchAccounts: 0,
      });
    }

    console.log(
      `📋 Processing ${batchAccounts.length} overflow accounts (accounts 11+)`
    );

    const syncResults = [];
    const startTime = Date.now();

    // Process batch accounts sequentially to stay under timeout
    for (const [index, account] of batchAccounts.entries()) {
      const accountStartTime = Date.now();
      console.log(
        `⏰ Processing overflow account ${index + 1}/${batchAccounts.length}: ${
          account.name
        }`
      );

      try {
        if (!account.workizApiToken) {
          throw new Error("Missing API token for this account");
        }

        // Calculate start_date as 2 months before current date
        const startDate = new Date();
        startDate.setMonth(startDate.getMonth() - 2);
        const startDateStr = startDate.toISOString().split("T")[0]; // Format as YYYY-MM-DD

        // Fetch jobs from Workiz API
        const workizUrl = `https://api.workiz.com/api/v1/${account.workizApiToken}/job/all/?start_date=${startDateStr}&offset=0&records=100&only_open=false`;

        const response = await RetryHandler.withRetry(
          async () => {
            const resp = await APIManager.fetchWithTimeout(
              workizUrl,
              {},
              45000
            );

            if (!resp.ok) {
              const errorText = await resp.text();
              throw new Error(
                `Workiz API error: ${resp.status} - ${errorText}`
              );
            }

            return resp;
          },
          5,
          2000,
          workizCircuitBreaker
        );

        const data = await response.json();
        if (!data.flag || !Array.isArray(data.data)) {
          throw new Error("Invalid response from Workiz API");
        }

        // Add accountId to each job
        const allJobs = data.data.map((job) => ({
          ...job,
          accountId: account._id || account.id,
        }));

        // Filter jobs by sourceFilter if configured
        let filteredJobs = allJobs;
        if (
          account.sourceFilter &&
          Array.isArray(account.sourceFilter) &&
          account.sourceFilter.length > 0
        ) {
          filteredJobs = allJobs.filter((job) =>
            account.sourceFilter.includes(job.JobSource)
          );
        }

        // Additional filtering by WhatConverts if configured
        if (
          account.whatconvertsApiKey &&
          account.whatconvertsApiSecret &&
          filteredJobs.length > 0
        ) {
          const phoneNumbers = [
            ...new Set(
              filteredJobs
                .map((job) => job.Phone)
                .filter((phone) => phone && phone.trim() !== "")
            ),
          ];

          const whatconvertsResults =
            await WhatConvertsAPI.checkMultiplePhonesInLeads(
              account.whatconvertsApiKey,
              account.whatconvertsApiSecret,
              phoneNumbers
            );

          let jobsWithGclid = 0;
          filteredJobs = filteredJobs.filter((job) => {
            if (!job.Phone || job.Phone.trim() === "") {
              return false;
            }

            const leadData = whatconvertsResults[job.Phone];
            if (!leadData || !leadData.exists || !leadData.hasGclid) {
              return false;
            }

            job.gclid = leadData.gclid;
            job.whatconvertsDateCreated = leadData.dateCreated;
            jobsWithGclid++;
            return true;
          });
        }

        if (filteredJobs.length === 0) {
          syncResults.push({
            account: account.name,
            success: true,
            duration: Date.now() - accountStartTime,
            jobsSynced: 0,
            message: "No jobs to sync",
          });
          continue;
        }

        // Upsert filtered jobs into MongoDB
        const bulkOps = filteredJobs.map((job) => ({
          updateOne: {
            filter: { UUID: job.UUID },
            update: { $set: job },
            upsert: true,
          },
        }));

        if (bulkOps.length > 0) {
          await db.collection("jobs").bulkWrite(bulkOps);
        }

        // Record sync history
        const syncHistoryRecord = {
          accountId: account._id || account.id,
          syncType: "jobs",
          status: "success",
          timestamp: new Date(),
          duration: Date.now() - accountStartTime,
          details: {
            jobsFromWorkiz: allJobs.length,
            filteredJobs: filteredJobs.length,
            syncMethod: "cron",
            batchType: "overflow",
          },
        };

        await RetryHandler.withRetry(async () => {
          await db.collection("syncHistory").insertOne(syncHistoryRecord);
        });

        // Update account's lastSyncDate
        await RetryHandler.withRetry(async () => {
          await db
            .collection("accounts")
            .updateOne(
              { _id: account._id || new ObjectId(account.id) },
              { $set: { lastSyncDate: new Date() } }
            );
        });

        syncResults.push({
          account: account.name,
          success: true,
          duration: Date.now() - accountStartTime,
          jobsSynced: filteredJobs.length,
        });
      } catch (error) {
        const accountDuration = Date.now() - accountStartTime;
        console.log(
          `❌ Batch sync failed for account ${account.name}: ${error.message}`
        );

        // Record failed sync history
        const syncHistoryRecord = {
          accountId: account._id || account.id,
          syncType: "jobs",
          status: "error",
          timestamp: new Date(),
          duration: accountDuration,
          errorMessage: error.message,
          details: {
            batchType: "overflow",
          },
        };

        try {
          await db.collection("syncHistory").insertOne(syncHistoryRecord);
        } catch (historyError) {
          console.error(
            "❌ Failed to record sync history:",
            historyError.message
          );
        }

        syncResults.push({
          account: account.name,
          success: false,
          duration: accountDuration,
          error: error.message,
        });
      }
    }

    const totalDuration = Date.now() - startTime;
    const successfulSyncs = syncResults.filter((r) => r.success).length;
    const failedSyncs = syncResults.filter((r) => !r.success).length;

    console.log(`🎯 Batch cron job completed in ${totalDuration}ms:`);
    console.log(`   - Successful: ${successfulSyncs} accounts`);
    console.log(`   - Failed: ${failedSyncs} accounts`);

    res.json({
      message: `Batch cron job completed: ${successfulSyncs} successful, ${failedSyncs} failed`,
      batchType: "overflow",
      duration: totalDuration,
      results: syncResults,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.log(`❌ Batch cron job error: ${error.message}`);
    res.status(500).json({
      error: error.message,
      batchType: "overflow",
      timestamp: new Date().toISOString(),
    });
  }
});

// Cron job endpoint for scheduled batch continuations
app.get("/api/cron/continue-batch-processing", async (req, res) => {
  try {
    // Enhanced security validation
    const userAgent = req.get("User-Agent");
    const clientIP = req.ip || req.connection.remoteAddress;

    if (!userAgent || !userAgent.includes("vercel-cron")) {
      console.log(`❌ Unauthorized cron access attempt:`, {
        userAgent,
        clientIP,
        timestamp: new Date().toISOString(),
      });
      return res.status(403).json({
        error: "Unauthorized",
        timestamp: new Date().toISOString(),
      });
    }

    const functionStartTime = Date.now();
    console.log(
      `🕐 Vercel Cron Job for batch continuation triggered at: ${new Date().toISOString()}`
    );

    // Ensure database connection
    const db = await ensureDbConnection();
    await DatabaseManager.ensureHealthyConnection(db);

    // Find paused batch processing states that are ready to continue
    const now = new Date();
    console.log(`🕐 Current time: ${now.toISOString()}`);

    const readyBatches = await db
      .collection("batchProcessing")
      .find({
        status: "paused",
        nextBatchTime: { $lte: now },
        stopRequested: { $exists: false }, // Skip if stop was requested
      })
      .toArray();

    console.log(
      `📋 Found ${readyBatches.length} batch processing states ready to continue`
    );

    if (readyBatches.length > 0) {
      console.log(
        `📋 Batch details:`,
        readyBatches.map((batch) => ({
          accountId: batch.accountId,
          status: batch.status,
          currentBatch: batch.currentBatch,
          totalBatches: batch.totalBatches,
          nextBatchTime: batch.nextBatchTime,
          stopRequested: batch.stopRequested,
        }))
      );
    }

    if (readyBatches.length === 0) {
      return res.json({
        message: "No batch processing states ready to continue",
        timestamp: new Date().toISOString(),
      });
    }

    const results = [];

    // Process each ready batch
    for (const batchState of readyBatches) {
      try {
        console.log(
          `🔄 Continuing batch processing for account: ${batchState.accountId}`
        );

        // Check if account exists before continuing
        const account = await db.collection("accounts").findOne({
          $or: [
            { _id: new ObjectId(batchState.accountId) },
            { id: batchState.accountId },
          ],
        });

        if (!account) {
          console.log(
            `❌ Account not found for batch processing: ${batchState.accountId}`
          );
          results.push({
            accountId: batchState.accountId,
            success: false,
            error: "Account not found",
          });
          continue;
        }

        console.log(`✅ Account found: ${account.name}`);

        // Directly call the continuation function instead of HTTP call
        console.log(
          `🔄 Directly calling continuation function for account: ${batchState.accountId}`
        );

        try {
          // Import the continuation logic directly
          const continuationResult = await processBatchContinuation(
            batchState.accountId,
            functionStartTime
          );

          results.push({
            accountId: batchState.accountId,
            success: true,
            result: continuationResult,
          });
          console.log(
            `✅ Successfully continued batch processing for account: ${batchState.accountId}`
          );
        } catch (continuationError) {
          console.log(
            `❌ Failed to continue batch processing for account: ${batchState.accountId}`
          );
          console.log(`❌ Error: ${continuationError.message}`);

          results.push({
            accountId: batchState.accountId,
            success: false,
            error: continuationError.message,
          });
        }
      } catch (error) {
        results.push({
          accountId: batchState.accountId,
          success: false,
          error: error.message,
        });
        console.log(
          `❌ Error continuing batch processing for account: ${batchState.accountId}: ${error.message}`
        );
      }
    }

    const successful = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success).length;

    console.log(
      `🎯 Batch continuation cron job completed: ${successful} successful, ${failed} failed`
    );

    res.json({
      message: `Batch continuation cron job completed: ${successful} successful, ${failed} failed`,
      timestamp: new Date().toISOString(),
      results: results,
    });
  } catch (error) {
    console.log(`❌ Batch continuation cron job error: ${error.message}`);
    res.status(500).json({
      error: error.message,
      timestamp: new Date().toISOString(),
    });
  }
});

// Enhanced monitoring and health check endpoints
app.get("/api/health", async (req, res) => {
  try {
    const db = await ensureDbConnection();
    const dbHealthy = await DatabaseManager.healthCheck(db);

    const healthStatus = {
      status: dbHealthy ? "healthy" : "unhealthy",
      timestamp: new Date().toISOString(),
      services: {
        database: dbHealthy ? "connected" : "disconnected",
        api: "running",
      },
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      environment: process.env.NODE_ENV || "development",
    };

    res.status(dbHealthy ? 200 : 503).json(healthStatus);
  } catch (error) {
    res.status(503).json({
      status: "unhealthy",
      timestamp: new Date().toISOString(),
      error: error.message,
      services: {
        database: "error",
        api: "running",
      },
    });
  }
});

app.get("/api/metrics", async (req, res) => {
  try {
    const db = await ensureDbConnection();

    // Get basic metrics
    const accountCount = await db.collection("accounts").countDocuments();
    const jobCount = await db.collection("jobs").countDocuments();
    const syncHistoryCount = await db
      .collection("syncHistory")
      .countDocuments();

    // Get recent sync history
    const recentSyncs = await db
      .collection("syncHistory")
      .find({})
      .sort({ timestamp: -1 })
      .limit(10)
      .toArray();

    // Calculate success rate
    const successfulSyncs = recentSyncs.filter(
      (sync) => sync.status === "success"
    ).length;
    const successRate =
      recentSyncs.length > 0
        ? ((successfulSyncs / recentSyncs.length) * 100).toFixed(2)
        : 0;

    const metrics = {
      timestamp: new Date().toISOString(),
      counts: {
        accounts: accountCount,
        jobs: jobCount,
        syncHistory: syncHistoryCount,
      },
      recentSyncs: {
        total: recentSyncs.length,
        successful: successfulSyncs,
        failed: recentSyncs.length - successfulSyncs,
        successRate: `${successRate}%`,
      },
      system: {
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        nodeVersion: process.version,
        environment: process.env.NODE_ENV || "development",
      },
    };

    res.json(metrics);
  } catch (error) {
    res.status(500).json({
      error: error.message,
      timestamp: new Date().toISOString(),
    });
  }
});

app.get("/api/cron/status", async (req, res) => {
  try {
    const db = await ensureDbConnection();

    // Get last cron job execution for individual accounts
    const lastIndividualCronSync = await db
      .collection("syncHistory")
      .find({
        syncType: "jobs",
        "details.cronJobIndex": { $exists: true },
        "details.cronJobIndex": { $lte: 10 },
      })
      .sort({ timestamp: -1 })
      .limit(1)
      .toArray();

    // Get last batch cron job execution
    const lastBatchCronSync = await db
      .collection("syncHistory")
      .find({
        syncType: "jobs",
        "details.batchType": "overflow",
      })
      .sort({ timestamp: -1 })
      .limit(1)
      .toArray();

    // Get cron job statistics for the last 7 days
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const recentCronSyncs = await db
      .collection("syncHistory")
      .find({
        syncType: "jobs",
        timestamp: { $gte: sevenDaysAgo },
      })
      .toArray();

    const successfulCronSyncs = recentCronSyncs.filter(
      (sync) => sync.status === "success"
    );
    const failedCronSyncs = recentCronSyncs.filter(
      (sync) => sync.status === "error"
    );

    // Get individual account cron job stats
    const individualCronStats = {};
    for (let i = 1; i <= 10; i++) {
      const accountCronSyncs = recentCronSyncs.filter(
        (sync) => sync.details?.cronJobIndex === i
      );
      const successfulAccountSyncs = accountCronSyncs.filter(
        (sync) => sync.status === "success"
      );

      individualCronStats[`account${i}`] = {
        total: accountCronSyncs.length,
        successful: successfulAccountSyncs.length,
        failed: accountCronSyncs.length - successfulAccountSyncs.length,
        successRate:
          accountCronSyncs.length > 0
            ? `${(
                (successfulAccountSyncs.length / accountCronSyncs.length) *
                100
              ).toFixed(2)}%`
            : "0%",
        lastExecution:
          accountCronSyncs.length > 0 ? accountCronSyncs[0].timestamp : null,
      };
    }

    // Get batch cron job stats
    const batchCronSyncs = recentCronSyncs.filter(
      (sync) => sync.details?.batchType === "overflow"
    );
    const successfulBatchSyncs = batchCronSyncs.filter(
      (sync) => sync.status === "success"
    );

    const cronStatus = {
      timestamp: new Date().toISOString(),
      cronJobType: "hybrid",
      individualAccounts: {
        lastExecution:
          lastIndividualCronSync.length > 0
            ? {
                timestamp: lastIndividualCronSync[0].timestamp,
                status: lastIndividualCronSync[0].status,
                duration: lastIndividualCronSync[0].duration,
                accountIndex: lastIndividualCronSync[0].details?.cronJobIndex,
              }
            : null,
        stats: individualCronStats,
      },
      batchAccounts: {
        lastExecution:
          lastBatchCronSync.length > 0
            ? {
                timestamp: lastBatchCronSync[0].timestamp,
                status: lastBatchCronSync[0].status,
                duration: lastBatchCronSync[0].duration,
                batchType: lastBatchCronSync[0].details?.batchType,
              }
            : null,
        stats: {
          total: batchCronSyncs.length,
          successful: successfulBatchSyncs.length,
          failed: batchCronSyncs.length - successfulBatchSyncs.length,
          successRate:
            batchCronSyncs.length > 0
              ? `${(
                  (successfulBatchSyncs.length / batchCronSyncs.length) *
                  100
                ).toFixed(2)}%`
              : "0%",
        },
      },
      overall: {
        total: recentCronSyncs.length,
        successful: successfulCronSyncs.length,
        failed: failedCronSyncs.length,
        successRate:
          recentCronSyncs.length > 0
            ? `${(
                (successfulCronSyncs.length / recentCronSyncs.length) *
                100
              ).toFixed(2)}%`
            : "0%",
        averageDuration:
          successfulCronSyncs.length > 0
            ? successfulCronSyncs.reduce(
                (sum, sync) => sum + (sync.duration || 0),
                0
              ) / successfulCronSyncs.length
            : 0,
      },
      nextScheduled: {
        time: "09:00 UTC",
        frequency: "Daily",
        cronExpression: "0 9 * * *",
        endpoints: [
          "/api/cron/sync-jobs/account1",
          "/api/cron/sync-jobs/account2",
          "/api/cron/sync-jobs/account3",
          "/api/cron/sync-jobs/account4",
          "/api/cron/sync-jobs/account5",
          "/api/cron/sync-jobs/account6",
          "/api/cron/sync-jobs/account7",
          "/api/cron/sync-jobs/account8",
          "/api/cron/sync-jobs/account9",
          "/api/cron/sync-jobs/account10",
          "/api/cron/sync-jobs/batch",
        ],
      },
    };

    res.json(cronStatus);
  } catch (error) {
    res.status(500).json({
      error: error.message,
      timestamp: new Date().toISOString(),
    });
  }
});

// Circuit breaker status endpoint
app.get("/api/circuit-breaker/status", (req, res) => {
  try {
    const status = {
      timestamp: new Date().toISOString(),
      workiz: workizCircuitBreaker.getState(),
      sheets: sheetsCircuitBreaker.getState(),
      summary: {
        workizState: workizCircuitBreaker.getState().state,
        sheetsState: sheetsCircuitBreaker.getState().state,
        workizFailures: workizCircuitBreaker.getState().failureCount,
        sheetsFailures: sheetsCircuitBreaker.getState().failureCount,
      },
    };

    res.json(status);
  } catch (error) {
    res.status(500).json({
      error: error.message,
      timestamp: new Date().toISOString(),
    });
  }
});

// WhatConverts API service for phone number validation
class WhatConvertsAPI {
  static async checkPhoneInLeads(
    apiKey,
    apiSecret,
    phoneNumber,
    timeout = 10000
  ) {
    try {
      // Format phone number to E.164 format with + prefix
      const formattedPhone = this.formatPhoneToE164(phoneNumber);

      // Calculate start_date as 2 months before current date
      const startDate = new Date();
      startDate.setMonth(startDate.getMonth() - 2);
      const startDateStr = startDate.toISOString().split("T")[0]; // Format as YYYY-MM-DD

      // Build URL with query parameters
      const url = `https://app.whatconverts.com/api/v1/leads?start_date=${startDateStr}&phone_number=${encodeURIComponent(
        formattedPhone
      )}`;

      const response = await APIManager.fetchWithTimeout(
        url,
        {
          headers: {
            Authorization: `Basic ${Buffer.from(
              `${apiKey}:${apiSecret}`
            ).toString("base64")}`,
            "Content-Type": "application/json",
          },
        },
        timeout
      );

      if (!response.ok) {
        const errorText = await response.text();
        console.log(
          `❌ WhatConverts API error: ${response.status} - ${errorText}`
        );
        throw new Error(
          `WhatConverts API error: ${response.status} - ${errorText}`
        );
      }

      const data = await response.json();

      // Robustly extract leads array
      let leads = [];
      if (Array.isArray(data)) {
        leads = data;
      } else if (Array.isArray(data.leads)) {
        leads = data.leads;
      } else if (Array.isArray(data.data)) {
        leads = data.data;
      }

      const phoneExists = leads.length > 0;

      if (phoneExists) {
        // Get the first lead (assuming one phone number per lead)
        const lead = leads[0];
        const gclid = lead.gclid || null;
        const dateCreated = lead.date_created || lead.DateCreated || null;

        return {
          exists: true,
          gclid: gclid,
          dateCreated: dateCreated,
          hasGclid: !!gclid,
        };
      } else {
        return {
          exists: false,
          gclid: null,
          dateCreated: null,
          hasGclid: false,
        };
      }
    } catch (error) {
      console.log(
        `❌ WhatConverts API check failed for ${phoneNumber}: ${error.message}`
      );
      // Return false on error to be safe (don't include job if we can't verify)
      return {
        exists: false,
        gclid: null,
        dateCreated: null,
        hasGclid: false,
      };
    }
  }

  static async checkMultiplePhonesInLeads(
    apiKey,
    apiSecret,
    phoneNumbers,
    timeout = 10000
  ) {
    try {
      // Create a batch request or check phones individually
      const results = {};

      for (const phone of phoneNumbers) {
        try {
          const leadData = await this.checkPhoneInLeads(
            apiKey,
            apiSecret,
            phone,
            timeout
          );
          results[phone] = leadData;

          // Add small delay between requests to avoid rate limiting
          await new Promise((resolve) => setTimeout(resolve, 100));
        } catch (error) {
          console.log(`❌ Failed to check phone ${phone}: ${error.message}`);
          results[phone] = {
            exists: false,
            gclid: null,
            dateCreated: null,
            hasGclid: false,
          };
        }
      }

      const phonesFound = Object.values(results).filter((r) => r.exists).length;
      const phonesWithGclid = Object.values(results).filter(
        (r) => r.hasGclid
      ).length;

      console.log(
        `📊 WhatConverts check results: ${phonesFound}/${phoneNumbers.length} phones found, ${phonesWithGclid} with gclid`
      );
      return results;
    } catch (error) {
      console.log(`❌ WhatConverts batch check failed: ${error.message}`);
      // Return all false on batch error
      return phoneNumbers.reduce((acc, phone) => {
        acc[phone] = {
          exists: false,
          gclid: null,
          dateCreated: null,
          hasGclid: false,
        };
        return acc;
      }, {});
    }
  }

  // Helper method to format phone number to E.164 format with + prefix
  static formatPhoneToE164(phoneNumber) {
    if (!phoneNumber) return "";

    // Remove all non-digit characters
    const digits = phoneNumber.replace(/\D/g, "");

    // If it's already 11 digits and starts with 1, ensure + prefix
    if (digits.length === 11 && digits.startsWith("1")) {
      return `+${digits}`;
    }

    // If it's 10 digits, assume US number and add +1
    if (digits.length === 10) {
      return `+1${digits}`;
    }

    // If it's already in E.164 format with +, return as is
    if (phoneNumber.startsWith("+")) {
      return phoneNumber;
    }

    // If it's 11 digits without +, add it
    if (digits.length === 11) {
      return `+${digits}`;
    }

    // For any other format, try to normalize to E.164
    // If we have at least 10 digits, assume US number
    if (digits.length >= 10) {
      const last10Digits = digits.slice(-10);
      return `+1${last10Digits}`;
    }

    // Otherwise, return with + prefix if it doesn't have one
    return phoneNumber.startsWith("+") ? phoneNumber : `+${phoneNumber}`;
  }
}

connectToMongoDB().then(() => {
  app.listen(port, () => {
    console.log(`Server running on port ${port}`);
  });
});

// Batch processing status endpoint
app.get("/api/batch-processing/status/:accountId", async (req, res) => {
  try {
    const db = await ensureDbConnection();
    const { accountId } = req.params;

    // Find account by ID - try both id and _id fields
    const account = await db.collection("accounts").findOne({
      $or: [{ _id: new ObjectId(accountId) }, { id: accountId }],
    });

    if (!account) {
      return res.status(404).json({ error: "Account not found" });
    }

    // Get batch processing state
    const batchState = await BatchProcessingManager.getBatchState(
      db,
      accountId
    );

    if (!batchState) {
      return res.json({
        message: "No active batch processing found",
        accountName: account.name,
        status: "none",
      });
    }

    // Calculate progress and estimated completion
    const progress =
      batchState.totalBatches > 0
        ? Math.round((batchState.currentBatch / batchState.totalBatches) * 100)
        : 0;

    const estimatedCompletionTime = batchState.estimatedCompletionTime
      ? new Date(batchState.estimatedCompletionTime)
      : null;

    const status = {
      accountId: accountId,
      accountName: account.name,
      status: batchState.status,
      progress: `${progress}%`,
      currentBatch: batchState.currentBatch,
      totalBatches: batchState.totalBatches,
      processedJobs: batchState.processedJobs,
      totalJobs: batchState.totalJobs,
      stats: {
        updatedJobs: batchState.updatedJobs,
        deletedJobs: batchState.deletedJobs,
        failedUpdates: batchState.failedUpdates,
      },
      timing: {
        startTime: batchState.startTime,
        lastBatchTime: batchState.lastBatchTime,
        nextBatchTime: batchState.nextBatchTime,
        estimatedCompletionTime: estimatedCompletionTime,
      },
      createdAt: batchState.createdAt,
      updatedAt: batchState.updatedAt,
    };

    res.json(status);
  } catch (error) {
    console.error("Error getting batch processing status:", error);
    res.status(500).json({ error: error.message });
  }
});

// Stop batch processing endpoint
app.post("/api/stop-update-cleanup/:accountId", async (req, res) => {
  try {
    const db = await ensureDbConnection();
    const { accountId } = req.params;

    // Find account by ID - try both id and _id fields
    const account = await db.collection("accounts").findOne({
      $or: [{ _id: new ObjectId(accountId) }, { id: accountId }],
    });

    if (!account) {
      return res.status(404).json({ error: "Account not found" });
    }

    // Get current batch processing state
    const batchState = await BatchProcessingManager.getBatchState(
      db,
      accountId
    );

    if (!batchState) {
      return res.status(404).json({
        error: "No active batch processing found for this account",
      });
    }

    // Stop the batch processing
    const stopped = await BatchProcessingManager.stopBatchProcessing(
      db,
      accountId
    );

    if (!stopped) {
      return res.status(500).json({
        error: "Failed to stop batch processing",
      });
    }

    console.log(`⏹️ Batch processing stopped for account: ${account.name}`);

    // Record stop action in sync history
    const syncHistoryRecord = {
      accountId: account._id || account.id,
      syncType: "update-cleanup",
      status: "stopped",
      timestamp: new Date(),
      details: {
        currentBatch: batchState.currentBatch,
        totalBatches: batchState.totalBatches,
        processedJobs: batchState.processedJobs,
        updatedJobs: batchState.updatedJobs,
        deletedJobs: batchState.deletedJobs,
        failedUpdates: batchState.failedUpdates,
        stopReason: "user_requested",
      },
    };

    await RetryHandler.withRetry(async () => {
      await db.collection("syncHistory").insertOne(syncHistoryRecord);
    });

    res.json({
      message: `Batch processing stopped for account ${account.name}`,
      details: {
        status: "stopped",
        currentBatch: batchState.currentBatch,
        totalBatches: batchState.totalBatches,
        progress: `${Math.round(
          (batchState.currentBatch / batchState.totalBatches) * 100
        )}%`,
        processedJobs: batchState.processedJobs,
        updatedJobs: batchState.updatedJobs,
        deletedJobs: batchState.deletedJobs,
        failedUpdates: batchState.failedUpdates,
        stoppedAt: new Date(),
      },
    });
  } catch (error) {
    console.error("Error stopping batch processing:", error);
    res.status(500).json({ error: error.message });
  }
});

// Resume batch processing endpoint
app.post("/api/resume-update-cleanup/:accountId", async (req, res) => {
  try {
    const db = await ensureDbConnection();
    const { accountId } = req.params;

    // Find account by ID - try both id and _id fields
    const account = await db.collection("accounts").findOne({
      $or: [{ _id: new ObjectId(accountId) }, { id: accountId }],
    });

    if (!account) {
      return res.status(404).json({ error: "Account not found" });
    }

    // Get current batch processing state
    const batchState = await db.collection("batchProcessing").findOne({
      accountId: accountId,
      status: "stopped",
    });

    if (!batchState) {
      return res.status(404).json({
        error: "No stopped batch processing found for this account",
      });
    }

    // Resume the batch processing
    const resumed = await BatchProcessingManager.resumeBatchProcessing(
      db,
      accountId
    );

    if (!resumed) {
      return res.status(500).json({
        error: "Failed to resume batch processing",
      });
    }

    console.log(`▶️ Batch processing resumed for account: ${account.name}`);

    // Schedule next batch to run immediately (5 minutes from now)
    const nextBatchTime = new Date(Date.now() + 5 * 60 * 1000);
    await BatchProcessingManager.scheduleNextBatch(
      db,
      accountId,
      nextBatchTime
    );

    // Record resume action in sync history
    const syncHistoryRecord = {
      accountId: account._id || account.id,
      syncType: "update-cleanup",
      status: "resumed",
      timestamp: new Date(),
      details: {
        currentBatch: batchState.currentBatch,
        totalBatches: batchState.totalBatches,
        processedJobs: batchState.processedJobs,
        updatedJobs: batchState.updatedJobs,
        deletedJobs: batchState.deletedJobs,
        failedUpdates: batchState.failedUpdates,
        nextBatchTime: nextBatchTime,
      },
    };

    await RetryHandler.withRetry(async () => {
      await db.collection("syncHistory").insertOne(syncHistoryRecord);
    });

    res.json({
      message: `Batch processing resumed for account ${account.name}`,
      details: {
        status: "running",
        currentBatch: batchState.currentBatch,
        totalBatches: batchState.totalBatches,
        progress: `${Math.round(
          (batchState.currentBatch / batchState.totalBatches) * 100
        )}%`,
        processedJobs: batchState.processedJobs,
        updatedJobs: batchState.updatedJobs,
        deletedJobs: batchState.deletedJobs,
        failedUpdates: batchState.failedUpdates,
        nextBatchTime: nextBatchTime.toISOString(),
        resumedAt: new Date(),
      },
    });
  } catch (error) {
    console.error("Error resuming batch processing:", error);
    res.status(500).json({ error: error.message });
  }
});

// Export for Vercel serverless functions
export default app;
