import express from "express";
import cors from "cors";
import { MongoClient, ObjectId } from "mongodb";
import dotenv from "dotenv";
import { google } from "googleapis";
import { formatInTimeZone } from "date-fns-tz";

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

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

// Account management endpoints
app.post("/api/accounts", async (req, res) => {
  try {
    const accountData = {
      ...req.body,
      syncEnabled: req.body.syncEnabled ?? false,
      syncFrequency: req.body.syncFrequency ?? "daily",
      syncTime: req.body.syncTime ?? "09:00",
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const result = await db.collection("accounts").insertOne(accountData);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/accounts", async (req, res) => {
  try {
    const accounts = await db.collection("accounts").find().toArray();
    // Transform _id to id for frontend
    const transformedAccounts = accounts.map((account) => ({
      ...account,
      id: account._id.toString(),
      _id: undefined,
    }));
    res.json(transformedAccounts);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put("/api/accounts/:id", async (req, res) => {
  try {
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
    res.status(500).json({ error: error.message });
  }
});

app.delete("/api/accounts/:id", async (req, res) => {
  try {
    const result = await db.collection("accounts").deleteOne({
      _id: new ObjectId(req.params.id),
    });

    if (result.deletedCount === 0) {
      return res.status(404).json({ error: "Account not found" });
    }

    res.json({ message: "Account deleted successfully" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Sync history endpoints
app.post("/api/sync-history", async (req, res) => {
  try {
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
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/sync-history/:accountId", async (req, res) => {
  try {
    const { accountId } = req.params;
    const syncHistory = await db
      .collection("syncHistory")
      .find({ accountId })
      .sort({ timestamp: -1 })
      .limit(50) // Limit to last 50 sync records
      .toArray();

    // Transform _id to id for frontend
    const transformedHistory = syncHistory.map((record) => ({
      ...record,
      id: record._id.toString(),
      _id: undefined,
    }));

    res.json(transformedHistory);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Jobs endpoints
app.get("/api/jobs", async (req, res) => {
  try {
    const jobs = await db
      .collection("jobs")
      .find()
      .sort({ JobDateTime: -1 })
      .toArray();
    res.json(jobs);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Sync jobs from Workiz and save to MongoDB
app.post("/api/sync-jobs/:accountId", async (req, res) => {
  try {
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

    // Fetch jobs from Workiz API using the token from the account
    const workizUrl = `https://api.workiz.com/api/v1/${account.workizApiToken}/job/all/?start_date=2025-01-01&offset=0&records=100&only_open=false`;
    console.log(`🌐 Fetching from Workiz: ${workizUrl}`);

    const response = await fetch(workizUrl);

    if (!response.ok) {
      const errorText = await response.text();
      console.log(`❌ Workiz API error: ${response.status} - ${errorText}`);
      return res.status(500).json({ error: errorText });
    }

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
    const jobs = data.data.map((job) => ({
      ...job,
      accountId: account._id || account.id,
    }));

    console.log(
      `🏷️ Added accountId to jobs. Sample job UUIDs: ${jobs
        .slice(0, 3)
        .map((j) => j.UUID)
        .join(", ")}`
    );

    // Check for existing jobs with same UUIDs
    const existingJobCount = await db.collection("jobs").countDocuments({
      UUID: { $in: jobs.map((job) => job.UUID) },
    });
    console.log(
      `🔍 Found ${existingJobCount} existing jobs with matching UUIDs`
    );

    // Upsert jobs into MongoDB
    const bulkOps = jobs.map((job) => ({
      updateOne: {
        filter: { UUID: job.UUID },
        update: { $set: job },
        upsert: true,
      },
    }));

    console.log(`💾 Executing bulk write with ${bulkOps.length} operations`);

    if (bulkOps.length > 0) {
      const bulkResult = await db.collection("jobs").bulkWrite(bulkOps);
      console.log(`✅ Bulk write completed:`, {
        matchedCount: bulkResult.matchedCount,
        modifiedCount: bulkResult.modifiedCount,
        upsertedCount: bulkResult.upsertedCount,
        insertedCount: bulkResult.insertedCount,
      });
    }

    // Verify final count
    const finalJobCount = await db.collection("jobs").countDocuments({
      accountId: account._id || account.id,
    });
    console.log(`📈 Final job count for account: ${finalJobCount}`);

    // Record sync history
    const syncHistoryRecord = {
      accountId: account._id || account.id,
      syncType: "jobs",
      status: "success",
      details: {
        jobsFromWorkiz: jobs.length,
        existingJobsFound: existingJobCount,
        finalJobCount: finalJobCount,
      },
    };

    await db.collection("syncHistory").insertOne(syncHistoryRecord);
    console.log(`📝 Sync history recorded for jobs sync`);

    // Update account's lastSyncDate
    await db
      .collection("accounts")
      .updateOne(
        { _id: account._id || new ObjectId(account.id) },
        { $set: { lastSyncDate: new Date() } }
      );

    res.json({
      message: `Synced ${jobs.length} jobs for account ${
        account.name || "Unknown"
      }`,
      details: {
        jobsFromWorkiz: jobs.length,
        existingJobsFound: existingJobCount,
        finalJobCount: finalJobCount,
      },
    });
  } catch (error) {
    console.log(`❌ Sync error: ${error.message}`);

    // Record failed sync history if we have account info
    if (req.params.accountId) {
      try {
        const syncHistoryRecord = {
          accountId: req.params.accountId,
          syncType: "jobs",
          status: "error",
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

// Google Sheets integration endpoint
app.post("/api/sync-to-sheets/:accountId", async (req, res) => {
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

    // Get all jobs for this account
    const allJobs = await db
      .collection("jobs")
      .find({ accountId: account._id || account.id })
      .toArray();

    console.log(`📊 Found ${allJobs.length} total jobs for account`);

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

    // Clear the sheet first (skip header row)
    console.log(`🧹 Clearing existing data from sheet (preserving headers)...`);
    try {
      await sheets.spreadsheets.values.clear({
        spreadsheetId: account.googleSheetsId,
        range: "Sheet1!A2:F", // Start from row 2 to preserve headers
      });
      console.log(`✅ Sheet cleared successfully (headers preserved)`);
    } catch (error) {
      console.log(`❌ Error clearing sheet: ${error.message}`);
      return res.status(500).json({
        error: "Failed to clear Google Sheet",
        details: error.message,
      });
    }

    // Prepare data for Google Sheets
    console.log(
      `📝 Preparing ${filteredJobs.length} jobs for Google Sheets...`
    );
    const values = filteredJobs.map((job, index) => {
      const formattedTime =
        formatInTimeZone(
          new Date(job.JobDateTime),
          "America/Los_Angeles",
          "yyyy-MM-dd'T'HH:mm:ss"
        ) + " America/Los_Angeles";

      if (index < 3) {
        console.log(
          `📋 Sample job ${index + 1}: ${job.Phone} | ${formattedTime} | ${
            job.JobSource
          }`
        );
      }

      return [
        job.Phone || "", // Caller's Phone Number
        formattedTime, // Call Start Time
        "Google Ads Convert", // Conversion Name
        "", // Conversion Time (blank)
        account.defaultConversionValue || 0, // Conversion Value
        "USD", // Conversion Currency
      ];
    });

    console.log(`📊 Prepared ${values.length} rows for Google Sheets`);

    // Add to Google Sheet (starting from row 2 to preserve headers)
    console.log(`📤 Adding data to Google Sheet (starting from row 2)...`);
    const response = await sheets.spreadsheets.values.append({
      spreadsheetId: account.googleSheetsId,
      range: "Sheet1!A2:F", // Start from row 2 to preserve headers
      valueInputOption: "USER_ENTERED",
      requestBody: {
        values,
      },
    });

    console.log(`✅ Google Sheets sync completed successfully`);
    console.log(`📈 Updated rows: ${response.data.updates?.updatedRows || 0}`);

    // Record sync history
    const syncHistoryRecord = {
      accountId: account._id || account.id,
      syncType: "sheets",
      status: "success",
      details: {
        totalJobs: allJobs.length,
        filteredJobs: filteredJobs.length,
        updatedRows: response.data.updates?.updatedRows || 0,
        sourceFilter: account.sourceFilter,
        sampleJobSources: [
          ...new Set(filteredJobs.slice(0, 5).map((job) => job.JobSource)),
        ],
      },
    };

    await db.collection("syncHistory").insertOne(syncHistoryRecord);
    console.log(`📝 Sync history recorded for sheets sync`);

    res.json({
      message: `Synced ${filteredJobs.length} jobs to Google Sheet for account ${account.name}`,
      details: {
        totalJobs: allJobs.length,
        filteredJobs: filteredJobs.length,
        updatedRows: response.data.updates?.updatedRows || 0,
        sourceFilter: account.sourceFilter,
        sampleJobSources: [
          ...new Set(filteredJobs.slice(0, 5).map((job) => job.JobSource)),
        ],
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

    if (!account.syncEnabled) {
      return res.status(400).json({ error: "Account sync is not enabled" });
    }

    console.log(`⏰ Manual sync for account: ${account.name}`);

    // Sync jobs
    try {
      const workizUrl = `https://api.workiz.com/api/v1/${account.workizApiToken}/job/all/?start_date=2025-01-01&offset=0&records=100&only_open=false`;
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
        details: {
          jobsFromWorkiz: jobs.length,
          finalJobCount: await db
            .collection("jobs")
            .countDocuments({ accountId: account._id || account.id }),
        },
      };

      await db.collection("syncHistory").insertOne(syncHistoryRecord);

      // Update account's lastSyncDate
      await db
        .collection("accounts")
        .updateOne(
          { _id: account._id || new ObjectId(account.id) },
          { $set: { lastSyncDate: new Date() } }
        );

      res.json({
        message: `Manual sync completed for account ${account.name}`,
        jobsSync: { success: true, jobsSynced: jobs.length },
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
        errorMessage: error.message,
        details: {},
      };
      await db.collection("syncHistory").insertOne(syncHistoryRecord);

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

// Cron job endpoint
app.post("/api/cron/sync-jobs", async (req, res) => {
  try {
    console.log("🕐 Cron job triggered at:", new Date().toISOString());

    // Get all accounts with sync enabled
    const accounts = await db
      .collection("accounts")
      .find({ syncEnabled: true })
      .toArray();
    console.log(`📋 Found ${accounts.length} accounts with sync enabled`);

    const results = [];

    for (const account of accounts) {
      // Check if it's time to sync this account
      const now = new Date();
      const currentHour = now.getHours();
      const currentMinute = now.getMinutes();
      const [syncHour, syncMinute] = account.syncTime.split(":").map(Number);

      // For Hobby plan, be more flexible with timing (within 2 hours of scheduled time)
      const timeDiff = Math.abs(
        currentHour * 60 + currentMinute - (syncHour * 60 + syncMinute)
      );
      if (timeDiff > 120) {
        // 2 hour window instead of 5 minutes
        console.log(
          `⏳ Not time to sync account: ${account.name} (current: ${currentHour}:${currentMinute}, sync: ${syncHour}:${syncMinute})`
        );
        continue;
      }

      // Check frequency - for Hobby plan, prioritize daily syncs
      let shouldSync = false;
      const lastSync = account.lastSyncDate
        ? new Date(account.lastSyncDate)
        : null;

      switch (account.syncFrequency) {
        case "daily":
          // For daily, check if we haven't synced today
          if (!lastSync) shouldSync = true;
          else {
            const today = new Date();
            const lastSyncDate = new Date(lastSync);
            shouldSync = today.toDateString() !== lastSyncDate.toDateString();
          }
          break;
        case "weekly":
          if (!lastSync) shouldSync = true;
          else {
            const daysSinceLastSync = Math.floor(
              (now - lastSync) / (1000 * 60 * 60 * 24)
            );
            shouldSync = daysSinceLastSync >= 7;
          }
          break;
        case "monthly":
          if (!lastSync) shouldSync = true;
          else {
            const monthsSinceLastSync =
              (now.getFullYear() - lastSync.getFullYear()) * 12 +
              (now.getMonth() - lastSync.getMonth());
            shouldSync = monthsSinceLastSync >= 1;
          }
          break;
        case "custom":
          // For custom, use 24-hour interval
          if (!lastSync) shouldSync = true;
          else {
            const hoursSinceLastSync = (now - lastSync) / (1000 * 60 * 60);
            shouldSync = hoursSinceLastSync >= 24;
          }
          break;
      }

      if (!shouldSync) {
        console.log(
          `⏳ Not time to sync account: ${account.name} (frequency: ${account.syncFrequency})`
        );
        continue;
      }

      console.log(`⏰ Time to sync account: ${account.name}`);

      // Sync jobs
      try {
        const workizUrl = `https://api.workiz.com/api/v1/${account.workizApiToken}/job/all/?start_date=2025-01-01&offset=0&records=100&only_open=false`;
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
          details: {
            jobsFromWorkiz: jobs.length,
            finalJobCount: await db
              .collection("jobs")
              .countDocuments({ accountId: account._id || account.id }),
          },
        };

        await db.collection("syncHistory").insertOne(syncHistoryRecord);

        // Update account's lastSyncDate
        await db
          .collection("accounts")
          .updateOne(
            { _id: account._id || new ObjectId(account.id) },
            { $set: { lastSyncDate: new Date() } }
          );

        results.push({
          account: account.name,
          jobsSync: { success: true, jobsSynced: jobs.length },
        });
      } catch (error) {
        console.error(
          `❌ Jobs sync failed for account ${account.name}:`,
          error.message
        );

        // Record failed sync history
        const syncHistoryRecord = {
          accountId: account._id || account.id,
          syncType: "jobs",
          status: "error",
          errorMessage: error.message,
          details: {},
        };
        await db.collection("syncHistory").insertOne(syncHistoryRecord);

        results.push({
          account: account.name,
          jobsSync: { success: false, error: error.message },
        });
      }

      // Sync to sheets (if Google Sheets ID is configured)
      if (account.googleSheetsId) {
        try {
          // Get all jobs for this account
          const allJobs = await db
            .collection("jobs")
            .find({ accountId: account._id || account.id })
            .toArray();

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
          }

          if (filteredJobs.length > 0) {
            // Parse Google Sheets credentials
            const credentialsStr =
              process.env.VITE_GOOGLE_SHEETS_CREDENTIALS ||
              process.env.GOOGLE_SHEETS_CREDENTIALS;
            if (!credentialsStr) {
              throw new Error("Google Sheets credentials not found");
            }

            const credentials = JSON.parse(credentialsStr);
            const auth = new google.auth.GoogleAuth({
              credentials,
              scopes: ["https://www.googleapis.com/auth/spreadsheets"],
            });

            const sheets = google.sheets({ version: "v4", auth });

            // Clear the sheet first (skip header row)
            await sheets.spreadsheets.values.clear({
              spreadsheetId: account.googleSheetsId,
              range: "Sheet1!A2:F",
            });

            // Prepare data for Google Sheets
            const values = filteredJobs.map((job) => {
              const formattedTime =
                formatInTimeZone(
                  new Date(job.JobDateTime),
                  "America/Los_Angeles",
                  "yyyy-MM-dd'T'HH:mm:ss"
                ) + " America/Los_Angeles";

              return [
                job.Phone || "",
                formattedTime,
                "Google Ads Convert",
                "",
                account.defaultConversionValue || 0,
                "USD",
              ];
            });

            // Add to Google Sheet
            const response = await sheets.spreadsheets.values.append({
              spreadsheetId: account.googleSheetsId,
              range: "Sheet1!A2:F",
              valueInputOption: "USER_ENTERED",
              requestBody: { values },
            });

            // Record sync history
            const syncHistoryRecord = {
              accountId: account._id || account.id,
              syncType: "sheets",
              status: "success",
              details: {
                totalJobs: allJobs.length,
                filteredJobs: filteredJobs.length,
                updatedRows: response.data.updates?.updatedRows || 0,
                sourceFilter: account.sourceFilter,
              },
            };

            await db.collection("syncHistory").insertOne(syncHistoryRecord);

            results.push({
              account: account.name,
              sheetsSync: {
                success: true,
                rowsUpdated: response.data.updates?.updatedRows || 0,
              },
            });
          }
        } catch (error) {
          console.error(
            `❌ Sheets sync failed for account ${account.name}:`,
            error.message
          );

          // Record failed sync history
          const syncHistoryRecord = {
            accountId: account._id || account.id,
            syncType: "sheets",
            status: "error",
            errorMessage: error.message,
            details: {},
          };
          await db.collection("syncHistory").insertOne(syncHistoryRecord);

          results.push({
            account: account.name,
            sheetsSync: { success: false, error: error.message },
          });
        }
      }
    }

    console.log("✅ Cron job completed successfully");
    res.status(200).json({
      message: "Cron job completed",
      timestamp: new Date().toISOString(),
      results,
    });
  } catch (error) {
    console.error("❌ Cron job failed:", error);
    res.status(500).json({
      error: error.message,
      timestamp: new Date().toISOString(),
    });
  }
});

connectToMongoDB().then(() => {
  app.listen(port, () => {
    console.log(`Server running on port ${port}`);
  });
});
