# Sync Setup Documentation

## Current Sync Configuration

### Automated Sync (Vercel Cron Jobs)

- **Schedule**: Daily at 9:00 AM UTC
- **Configuration**: `vercel.json` cron job
- **Endpoint**: `/api/cron/sync-jobs`
- **Behavior**: Syncs ALL accounts regardless of individual sync settings

### Manual Sync Options

- **Sync Jobs**: Manual trigger to sync jobs from Workiz to MongoDB
- **Sync to Google Sheets**: Manual trigger to sync filtered jobs to Google Sheets
- **Manual Sync**: Test trigger for immediate sync (same as automated sync)

## Phase 1 Enhancements ✅

### Enhanced Error Handling & Monitoring

- **RetryHandler**: Exponential backoff retry logic
- **APIManager**: Timeout handling and rate limiting
- **DatabaseManager**: Health checks and connection management

### Security Improvements

- **Enhanced User Agent Validation**: Detailed logging of unauthorized attempts
- **Client IP Tracking**: Monitor access patterns
- **Request Timeout Protection**: 45-second timeout for API calls

### Performance Optimizations

- **Batch Processing**: Process jobs in batches of 50 to prevent memory issues
- **Database Connection Pooling**: Efficient connection management
- **Resource Management**: Delays between batches to prevent overwhelming systems

### Monitoring Endpoints

- **`/api/health`**: System health check with database connectivity
- **`/api/metrics`**: Comprehensive system metrics and statistics
- **`/api/cron/status`**: Cron job execution history and performance

### Enhanced Logging

- **Structured Logging**: Consistent log format with timestamps
- **Performance Metrics**: Duration tracking for all operations
- **Error Stack Traces**: Detailed error information for debugging
- **Success Rate Tracking**: Monitor system reliability

## Changes Made

### Disabled Per-Account Automated Sync

- Removed "Enable Automated Syncing" toggle from Account Form
- Removed "Enable Automated Syncing" toggle from Account Edit Dialog
- Set `syncEnabled: false` by default for new accounts
- Removed syncEnabled check from manual trigger endpoint

### Updated UI

- Added info alerts explaining automated sync is handled by Vercel Cron Jobs
- Changed "Test Auto Sync" button to "Manual Sync"
- Added informational messages about 9:00 AM UTC schedule

### Updated Cron Job Logic

- Now syncs ALL accounts regardless of `syncEnabled` setting
- Simplified logic - no more per-account timing checks
- Added user agent validation for security
- Improved error handling and logging

## Benefits

1. **Simplified Management**: No need to configure sync settings per account
2. **Consistent Schedule**: All accounts sync at the same time (9:00 AM UTC)
3. **Reliable**: Vercel handles the scheduling, no server-side timing logic
4. **Cost Effective**: Single cron job instead of multiple scheduled tasks
5. **Easy Monitoring**: Centralized logging and error handling
6. **Enhanced Reliability**: Retry logic and error recovery
7. **Better Performance**: Optimized resource usage and batch processing
8. **Improved Security**: Enhanced validation and monitoring
9. **Comprehensive Observability**: Detailed metrics and health checks

## Future Considerations

If you want to re-enable per-account automated sync in the future:

1. Uncomment the Automated Sync Settings sections in:

   - `src/components/AccountForm.tsx`
   - `src/components/AccountList.tsx`

2. Update the cron job logic in `server.js` to check `syncEnabled` and timing

3. Update the manual trigger endpoint to check `syncEnabled`

4. Remove the info alerts about Vercel Cron Jobs

## Vercel Cron Job Configuration

```json
{
  "crons": [
    {
      "path": "/api/cron/sync-jobs",
      "schedule": "0 9 * * *"
    }
  ]
}
```

- `0 9 * * *` = Daily at 9:00 AM UTC
- Runs automatically on Vercel's infrastructure
- No additional cost on Hobby plan
- Reliable and monitored by Vercel

## Monitoring & Health Checks

### Health Check Endpoint

```bash
GET /api/health
```

Returns system health status including database connectivity.

### Metrics Endpoint

```bash
GET /api/metrics
```

Returns comprehensive system metrics and recent sync statistics.

### Cron Status Endpoint

```bash
GET /api/cron/status
```

Returns cron job execution history and performance metrics.

## Performance Metrics Tracked

- **Accounts Processed**: Number of accounts synced
- **Jobs Processed**: Total jobs from Workiz API
- **Jobs Updated**: Jobs updated in database
- **Jobs Deleted**: Jobs removed from database
- **API Calls**: Number of Workiz API calls
- **Database Operations**: Number of database operations
- **Success Rate**: Percentage of successful syncs
- **Duration**: Time taken for each operation
- **Error Count**: Number of errors encountered
