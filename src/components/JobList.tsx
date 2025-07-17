import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Alert,
  AlertTitle,
  Button,
  Link,
  LinearProgress,
  Card,
  CardContent,
  Chip,
  Collapse,
  IconButton,
} from '@mui/material';
import { 
  CheckCircle, 
  Error, 
  ExpandMore, 
  ExpandLess,
  CloudDownload,
  CloudUpload,
  Refresh,
  Update,
  Stop,
  PlayArrow
} from '@mui/icons-material';
import { Account } from '../types/index';
import { buildApiUrl } from '../utils/api';
import { convertToAccountTimezone } from '../utils/timezone';
import SyncHistoryComponent from './SyncHistory';

interface Job {
  UUID: string;
  FirstName: string;
  LastName: string;
  Address: string;
  City: string;
  State: string;
  JobType: string;
  JobSource: string;
  Status: string;
  JobDateTime: string;
  JobTotalPrice: number;
  apiKey?: string;
  accountId: string;
}

interface SyncProgress {
  phase: 'fetching' | 'processing' | 'updating' | 'cleaning' | 'complete' | 'batch-processing';
  percentage: number;
  message: string;
  details?: string;
}

interface SyncResult {
  success: boolean;
  message: string;
  details?: {
    jobsFromWorkiz?: number;
    existingJobsFound?: number;
    finalJobCount?: number;
    jobsUpdated?: number;
    jobsDeleted?: number;
    failedUpdates?: number;
    duration?: number;
  };
  timestamp: Date;
}

interface JobListProps {
  accounts: Account[];
}

// Helper function to safely extract error messages
function getErrorMessage(err: unknown): string {
  if (err instanceof Error) {
    return (err as Error).message;
  }
  if (typeof err === 'string') {
    return err;
  }
  return 'An unknown error occurred';
}

const JobList: React.FC<JobListProps> = ({ accounts }) => {
  const [selectedAccount, setSelectedAccount] = useState<Account | null>(null);
  const [allJobs, setAllJobs] = useState<Job[]>([]); // Store all jobs for counting
  const [error, setError] = useState<string>('');
  const [syncing, setSyncing] = useState(false);
  const [syncingToSheets, setSyncingToSheets] = useState(false);
  const [updatingAndCleaning, setUpdatingAndCleaning] = useState(false);
  const [refreshSyncHistory, setRefreshSyncHistory] = useState(0);
  const [manualTriggering, setManualTriggering] = useState(false);
  
  // New state for enhanced loading and progress
  const [syncProgress, setSyncProgress] = useState<SyncProgress | null>(null);
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null);
  const [showSyncDetails, setShowSyncDetails] = useState(false);
  const [batchStatus, setBatchStatus] = useState<any>(null);
  const [stoppingBatch, setStoppingBatch] = useState(false);
  const [resumingBatch, setResumingBatch] = useState(false);

  // Set initial selected account only once when component mounts
  useEffect(() => {
    if (accounts.length > 0 && !selectedAccount) {
      setSelectedAccount(accounts[0]);
    }
  }, []);

  // Check batch status periodically when there's an active batch
  useEffect(() => {
    if (!selectedAccount?.id) return;

    const checkStatus = async () => {
      await checkBatchStatus();
    };

    // Check immediately
    checkStatus();

    // Set up interval to check every 30 seconds if there's an active batch
    const interval = setInterval(async () => {
      if (batchStatus && ['running', 'paused'].includes(batchStatus.status)) {
        await checkStatus();
      }
    }, 30000);

    return () => clearInterval(interval);
  }, [selectedAccount?.id, batchStatus?.status]);

  // Fetch ALL jobs from DB when component mounts or accounts change
  useEffect(() => {
    const fetchAllJobs = async () => {
      if (accounts.length === 0) return;
      try {
        const response = await fetch(buildApiUrl('/api/jobs'));
        if (!response.ok) {
          console.error('Failed to fetch jobs from DB');
          setAllJobs([]);
          return;
        }
        const data = await response.json();
        setAllJobs(data);
      } catch (err) {
        console.error('Failed to fetch all jobs:', err);
        setAllJobs([]);
      }
    };
    fetchAllJobs();
  }, [accounts, syncing]);

  const handleAccountChange = (accountId: string) => {
    if (!accountId) {
      setSelectedAccount(null);
      return;
    }
    
    const account = accounts.find(a => a.id === accountId);
    if (account) {
      console.log('Manually selected account:', account.name);
      setSelectedAccount(account);
    } else {
      console.error('Account not found:', accountId);
      setSelectedAccount(null);
    }
  };

  const updateSyncProgress = (phase: SyncProgress['phase'], percentage: number, message: string, details?: string) => {
    setSyncProgress({
      phase,
      percentage,
      message,
      details
    });
  };

  const handleSync = async () => {
    if (!selectedAccount?.id) {
      console.error('No account ID available for sync');
      return;
    }
    
    setSyncing(true);
    setError('');
    setSyncResult(null);
    setShowSyncDetails(false);
    
    // Initialize progress
    updateSyncProgress('fetching', 0, 'Initializing sync...');
    
    try {
      console.log('Syncing jobs for account:', selectedAccount.id);
      
      // Simulate progress updates for better UX
      updateSyncProgress('fetching', 10, 'Connecting to Workiz API...');
      await new Promise<void>(resolve => setTimeout(resolve, 500));
      
      updateSyncProgress('fetching', 25, 'Fetching jobs from Workiz...');
      await new Promise<void>(resolve => setTimeout(resolve, 500));
      
      updateSyncProgress('processing', 40, 'Processing job data...');
      await new Promise<void>(resolve => setTimeout(resolve, 500));
      
      const response = await fetch(
        buildApiUrl(`/api/sync-jobs/${selectedAccount.id}`),
        { method: 'POST' }
      );
      
      updateSyncProgress('updating', 70, 'Updating database...');
      await new Promise<void>(resolve => setTimeout(resolve, 500));
      
      if (!response.ok) {
        const errorData = await response.json() as { error?: string };
        const errorMessage = errorData.error || 'Failed to sync jobs';
        setError(errorMessage);
        setSyncResult({
          success: false,
          message: 'Sync failed',
          timestamp: new Date()
        });
        return;
      }
      
      const result = await response.json() as { details?: any };
      
      updateSyncProgress('cleaning', 90, 'Cleaning up old data...');
      await new Promise<void>(resolve => setTimeout(resolve, 500));
      
      updateSyncProgress('complete', 100, 'Sync completed successfully!');
      await new Promise<void>(resolve => setTimeout(resolve, 1000));
      
      // Set success result
      setSyncResult({
        success: true,
        message: `Successfully synced ${result.details?.jobsFromWorkiz || 0} jobs`,
        details: result.details,
        timestamp: new Date()
      });
      
      // After successful sync, refresh sync history
      setRefreshSyncHistory(prev => prev + 1);
      
      // Reload jobs by triggering the useEffect
      const jobsResponse = await fetch(buildApiUrl('/api/jobs'));
      if (jobsResponse.ok) {
        const jobsData = await jobsResponse.json();
        setAllJobs(jobsData);
      }
      
    } catch (err: unknown) {
      console.error('Sync error:', err);
      const errorMessage = getErrorMessage(err);
      setError(errorMessage);
      
      // Set error result
      setSyncResult({
        success: false,
        message: 'Sync failed',
        timestamp: new Date()
      });
    } finally {
      setSyncing(false);
      // Keep progress visible for a moment, then clear
      setTimeout(() => setSyncProgress(null), 3000);
    }
  };

  const handleSyncToSheets = async () => {
    if (!selectedAccount?.id) return;
    setSyncingToSheets(true);
    setError('');
    setSyncResult(null);
    setShowSyncDetails(false);
    
    try {
      updateSyncProgress('fetching', 20, 'Preparing Google Sheets sync...');
      await new Promise<void>(resolve => setTimeout(resolve, 300));
      
      updateSyncProgress('processing', 50, 'Syncing to Google Sheets...');
      
      const response = await fetch(
        buildApiUrl(`/api/sync-to-sheets/${selectedAccount.id}`),
        { method: 'POST' }
      );
      const data = await response.json() as { error?: string; details?: any };
      
      if (!response.ok) {
        const errorMessage = data.error || 'Failed to sync to Google Sheets';
        setError(errorMessage);
        setSyncResult({
          success: false,
          message: 'Google Sheets sync failed',
          timestamp: new Date()
        });
        return;
      }
      
      updateSyncProgress('complete', 100, 'Google Sheets sync completed!');
      await new Promise<void>(resolve => setTimeout(resolve, 1000));
      
      setSyncResult({
        success: true,
        message: `Successfully synced to Google Sheets`,
        details: data.details,
        timestamp: new Date()
      });
      
      console.log('Sync to sheets successful:', data);
      setRefreshSyncHistory(prev => prev + 1); // Trigger sync history refresh
    } catch (err: unknown) {
      console.error('Sync to sheets error:', err);
      const errorMessage = getErrorMessage(err);
      setError(errorMessage);
      
      setSyncResult({
        success: false,
        message: 'Google Sheets sync failed',
        timestamp: new Date()
      });
    } finally {
      setSyncingToSheets(false);
      setTimeout(() => setSyncProgress(null), 3000);
    }
  };

  const handleManualTrigger = async () => {
    if (!selectedAccount?.id) return;
    setManualTriggering(true);
    setError('');
    setSyncResult(null);
    setShowSyncDetails(false);
    
    try {
      updateSyncProgress('fetching', 30, 'Triggering manual sync...');
      await new Promise<void>(resolve => setTimeout(resolve, 300));
      
      updateSyncProgress('processing', 60, 'Processing manual sync...');
      
      const response = await fetch(
        buildApiUrl(`/api/trigger-sync/${selectedAccount.id}`),
        { method: 'POST' }
      );
      const data = await response.json() as { error?: string; jobsSync?: { details?: any } };
      
      if (!response.ok) {
        const errorMessage = data.error || 'Failed to trigger manual sync';
        setError(errorMessage);
        setSyncResult({
          success: false,
          message: 'Manual sync failed',
          timestamp: new Date()
        });
        return;
      }
      
      updateSyncProgress('complete', 100, 'Manual sync completed!');
      await new Promise<void>(resolve => setTimeout(resolve, 1000));
      
      setSyncResult({
        success: true,
        message: `Manual sync completed successfully`,
        details: data.jobsSync?.details,
        timestamp: new Date()
      });
      
      console.log('Manual trigger successful:', data);
      setRefreshSyncHistory(prev => prev + 1); // Trigger sync history refresh
      
      // Reload jobs
      const jobsResponse = await fetch(buildApiUrl('/api/jobs'));
      if (jobsResponse.ok) {
        const jobsData = await jobsResponse.json();
        setAllJobs(jobsData);
      }
      
    } catch (err: unknown) {
      console.error('Manual trigger error:', err);
      const errorMessage = getErrorMessage(err);
      setError(errorMessage);
      
      setSyncResult({
        success: false,
        message: 'Manual sync failed',
        timestamp: new Date()
      });
    } finally {
      setManualTriggering(false);
      setTimeout(() => setSyncProgress(null), 3000);
    }
  };

  const checkBatchStatus = async () => {
    if (!selectedAccount?.id) return;
    
    try {
      const response = await fetch(
        buildApiUrl(`/api/batch-processing/status/${selectedAccount.id}`)
      );
      const data = await response.json();
      setBatchStatus(data);
    } catch (error) {
      console.error('Error checking batch status:', error);
    }
  };

  const handleStopBatch = async () => {
    if (!selectedAccount?.id) return;
    setStoppingBatch(true);
    setError('');
    
    try {
      const response = await fetch(
        buildApiUrl(`/api/stop-update-cleanup/${selectedAccount.id}`),
        { method: 'POST' }
      );
      const data = await response.json();
      
      if (!response.ok) {
        setError(data.error || 'Failed to stop batch processing');
        return;
      }
      
      setBatchStatus(data.details);
      setSyncResult({
        success: true,
        message: 'Batch processing stopped successfully',
        details: data.details,
        timestamp: new Date()
      });
      
      console.log('Batch stopped successfully:', data);
    } catch (err: unknown) {
      console.error('Error stopping batch:', err);
      setError(getErrorMessage(err));
    } finally {
      setStoppingBatch(false);
    }
  };

  const handleResumeBatch = async () => {
    if (!selectedAccount?.id) return;
    setResumingBatch(true);
    setError('');
    
    try {
      const response = await fetch(
        buildApiUrl(`/api/resume-update-cleanup/${selectedAccount.id}`),
        { method: 'POST' }
      );
      const data = await response.json();
      
      if (!response.ok) {
        setError(data.error || 'Failed to resume batch processing');
        return;
      }
      
      setBatchStatus(data.details);
      setSyncResult({
        success: true,
        message: 'Batch processing resumed successfully',
        details: data.details,
        timestamp: new Date()
      });
      
      console.log('Batch resumed successfully:', data);
    } catch (err: unknown) {
      console.error('Error resuming batch:', err);
      setError(getErrorMessage(err));
    } finally {
      setResumingBatch(false);
    }
  };

  const handleUpdateAndCleanup = async () => {
    if (!selectedAccount?.id) return;
    setUpdatingAndCleaning(true);
    setError('');
    setSyncResult(null);
    setShowSyncDetails(false);
    
    try {
      updateSyncProgress('fetching', 10, 'Starting job update and cleanup...');
      await new Promise<void>(resolve => setTimeout(resolve, 300));
      
      updateSyncProgress('batch-processing', 20, 'Processing jobs in batches...');
      await new Promise<void>(resolve => setTimeout(resolve, 500));
      
      const response = await fetch(
        buildApiUrl(`/api/update-cleanup-jobs/${selectedAccount.id}`),
        { method: 'POST' }
      );
      const data = await response.json() as { error?: string; details?: any };
      
      if (!response.ok) {
        const errorMessage = data.error || 'Failed to update and cleanup jobs';
        setError(errorMessage);
        setSyncResult({
          success: false,
          message: 'Update and cleanup failed',
          timestamp: new Date()
        });
        return;
      }
      
      updateSyncProgress('complete', 100, 'Update and cleanup completed!');
      await new Promise<void>(resolve => setTimeout(resolve, 1000));
      
      setSyncResult({
        success: true,
        message: `Update and cleanup completed successfully`,
        details: data.details,
        timestamp: new Date()
      });
      
      console.log('Update and cleanup successful:', data);
      setRefreshSyncHistory(prev => prev + 1); // Trigger sync history refresh
      
      // Check batch status after starting
      await checkBatchStatus();
      
      // Reload jobs
      const jobsResponse = await fetch(buildApiUrl('/api/jobs'));
      if (jobsResponse.ok) {
        const jobsData = await jobsResponse.json();
        setAllJobs(jobsData);
      }
      
    } catch (err: unknown) {
      console.error('Update and cleanup error:', err);
      const errorMessage = getErrorMessage(err);
      setError(errorMessage);
      
      setSyncResult({
        success: false,
        message: 'Update and cleanup failed',
        timestamp: new Date()
      });
    } finally {
      setUpdatingAndCleaning(false);
      setTimeout(() => setSyncProgress(null), 3000);
    }
  };

  const getProgressColor = (phase: SyncProgress['phase']) => {
    switch (phase) {
      case 'fetching': return 'primary';
      case 'processing': return 'info';
      case 'updating': return 'warning';
      case 'cleaning': return 'secondary';
      case 'batch-processing': return 'warning';
      case 'complete': return 'success';
      default: return 'primary';
    }
  };

  const getProgressIcon = (phase: SyncProgress['phase']) => {
    switch (phase) {
      case 'fetching': return <CloudDownload />;
      case 'processing': return <Refresh />;
      case 'updating': return <CloudUpload />;
      case 'cleaning': return <Refresh />;
      case 'batch-processing': return <Update />;
      case 'complete': return <CheckCircle />;
      default: return <CloudDownload />;
    }
  };

  const renderAccountInfo = (account: Account) => {
    const sourceFilterText = Array.isArray(account.sourceFilter) && account.sourceFilter.length > 0
      ? account.sourceFilter.join(', ')
      : 'All sources';
    
    const googleSheetsUrl = account.googleSheetsId 
      ? `https://docs.google.com/spreadsheets/d/${account.googleSheetsId}/edit`
      : null;
    
    return (
      <Box sx={{ mb: 2 }}>
        <Typography variant="h6" gutterBottom>
          {account.name || 'Unnamed Account'}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Source Filter: {sourceFilterText}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Default Conversion Value: ${account.defaultConversionValue}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Auto Sync: {account.syncEnabled ? 'Enabled' : 'Disabled'}
          {account.syncEnabled && ` (${account.syncFrequency} at ${account.syncTime})`}
        </Typography>
        {account.lastSyncDate && (
          <Typography variant="body2" color="text.secondary">
            Last Sync: {new Date(account.lastSyncDate).toLocaleString()}
          </Typography>
        )}
        {googleSheetsUrl && (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            📊 Google Sheet: {' '}
            <Link 
              href={googleSheetsUrl} 
              target="_blank" 
              rel="noopener noreferrer"
              sx={{ color: 'primary.main', textDecoration: 'none' }}
            >
              View Conversion Data
            </Link>
          </Typography>
        )}
      </Box>
    );
  };

  // Count jobs per account from allJobs using accountId
  const jobCounts: { [accountId: string]: number } = {};
  accounts.forEach(account => {
    if (account.id) {
      jobCounts[account.id] = allJobs.filter(job => String(job.accountId) === String(account.id)).length;
    }
  });

  if (!accounts || accounts.length === 0) {
    return (
      <Box sx={{ mt: 2 }}>
        <Alert severity="info">
          Please add an account to view jobs.
        </Alert>
      </Box>
    );
  }

  return (
    <Box sx={{ mt: 2 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Typography variant="h6" component="div">
          Workiz Jobs
        </Typography>
        <FormControl sx={{ minWidth: 200 }}>
          <InputLabel>Select Account</InputLabel>
          <Select
            value={selectedAccount?.id || ''}
            label="Select Account"
            onChange={(e) => handleAccountChange(e.target.value)}
          >
            <MenuItem value="">Select an account</MenuItem>
            {accounts.map((account) => (
              <MenuItem key={account.id} value={account.id}>
                {account.name}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
      </Box>

      {selectedAccount && (
        <>
          {renderAccountInfo(selectedAccount)}
          
          {/* Sync Progress */}
          {syncProgress && (
            <Card sx={{ mb: 2, border: '1px solid', borderColor: `${getProgressColor(syncProgress.phase)}.main` }}>
              <CardContent>
                <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
                  {getProgressIcon(syncProgress.phase)}
                  <Typography variant="h6" sx={{ ml: 1, flexGrow: 1 }}>
                    {syncProgress.message}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {syncProgress.percentage}%
                  </Typography>
                </Box>
                <LinearProgress 
                  variant="determinate" 
                  value={syncProgress.percentage} 
                  color={getProgressColor(syncProgress.phase)}
                  sx={{ height: 8, borderRadius: 4 }}
                />
                {syncProgress.details && (
                  <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                    {syncProgress.details}
                  </Typography>
                )}
              </CardContent>
            </Card>
          )}

          {/* Sync Result */}
          {syncResult && (
            <Card sx={{ 
              mb: 2, 
              border: '1px solid', 
              borderColor: syncResult.success ? 'success.main' : 'error.main',
              backgroundColor: syncResult.success ? 'success.50' : 'error.50'
            }}>
              <CardContent>
                <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
                  {syncResult.success ? <CheckCircle color="success" /> : <Error color="error" />}
                  <Typography variant="h6" sx={{ ml: 1, flexGrow: 1 }}>
                    {syncResult.message}
                  </Typography>
                  <IconButton 
                    size="small" 
                    onClick={() => setShowSyncDetails(!showSyncDetails)}
                  >
                    {showSyncDetails ? <ExpandLess /> : <ExpandMore />}
                  </IconButton>
                </Box>
                <Typography variant="body2" color="text.secondary">
                  {syncResult.timestamp.toLocaleString()}
                </Typography>
                
                <Collapse in={showSyncDetails}>
                  {syncResult.details && (
                    <Box sx={{ mt: 2, display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                      {syncResult.details.jobsFromWorkiz !== undefined && (
                        <Chip 
                          label={`${syncResult.details.jobsFromWorkiz} from Workiz`} 
                          color="primary" 
                          size="small" 
                        />
                      )}
                      {syncResult.details.existingJobsFound !== undefined && (
                        <Chip 
                          label={`${syncResult.details.existingJobsFound} existing`} 
                          color="info" 
                          size="small" 
                        />
                      )}
                      {syncResult.details.finalJobCount !== undefined && (
                        <Chip 
                          label={`${syncResult.details.finalJobCount} total`} 
                          color="success" 
                          size="small" 
                        />
                      )}
                      {syncResult.details.jobsUpdated !== undefined && (
                        <Chip 
                          label={`${syncResult.details.jobsUpdated} updated`} 
                          color="warning" 
                          size="small" 
                        />
                      )}
                      {syncResult.details.jobsDeleted !== undefined && (
                        <Chip 
                          label={`${syncResult.details.jobsDeleted} deleted`} 
                          color="error" 
                          size="small" 
                        />
                      )}
                      {syncResult.details.failedUpdates !== undefined && (
                        <Chip 
                          label={`${syncResult.details.failedUpdates} failed`} 
                          color="error" 
                          size="small" 
                        />
                      )}
                      {syncResult.details.duration !== undefined && (
                        <Chip 
                          label={`${Math.round(syncResult.details.duration / 1000)}s duration`} 
                          color="default" 
                          size="small" 
                        />
                      )}
                    </Box>
                  )}
                </Collapse>
              </CardContent>
            </Card>
          )}

          <Box sx={{ display: 'flex', gap: 2, mb: 2 }}>
            <Button
              variant="contained"
              color="primary"
              onClick={handleSync}
              disabled={syncing}
              startIcon={syncing ? <Refresh /> : <CloudDownload />}
            >
              {syncing ? 'Syncing...' : 'Sync Jobs'}
            </Button>
            <Button
              variant="contained"
              color="secondary"
              onClick={handleSyncToSheets}
              disabled={syncingToSheets || !selectedAccount.googleSheetsId}
              startIcon={syncingToSheets ? <Refresh /> : <CloudUpload />}
            >
              {syncingToSheets ? 'Syncing to Sheets...' : 'Sync to Google Sheets'}
            </Button>
            <Button
              variant="contained"
              color="warning"
              onClick={handleUpdateAndCleanup}
              disabled={updatingAndCleaning || !selectedAccount.workizApiToken}
              startIcon={updatingAndCleaning ? <Refresh /> : <Update />}
            >
              {updatingAndCleaning ? 'Updating & Cleaning...' : 'Update & Cleanup Jobs'}
            </Button>
            {selectedAccount.syncEnabled && (
              <Button
                variant="outlined"
                color="info"
                onClick={handleManualTrigger}
                disabled={manualTriggering}
                startIcon={manualTriggering ? <Refresh /> : <Refresh />}
              >
                {manualTriggering ? 'Triggering...' : 'Manual Sync'}
              </Button>
            )}
          </Box>

          {/* Batch Processing Status */}
          {batchStatus && batchStatus.status !== 'none' && (
            <Card sx={{ mb: 2, border: '1px solid', borderColor: 'warning.main' }}>
              <CardContent>
                <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
                  <Update color="warning" />
                  <Typography variant="h6" sx={{ ml: 1, flexGrow: 1 }}>
                    Batch Processing Status
                  </Typography>
                  <Chip 
                    label={batchStatus.status.toUpperCase()} 
                    color={batchStatus.status === 'running' ? 'success' : batchStatus.status === 'stopped' ? 'error' : 'warning'}
                    size="small"
                  />
                </Box>
                
                <Box sx={{ mb: 2 }}>
                  <Typography variant="body2" color="text.secondary" gutterBottom>
                    Progress: {batchStatus.progress} ({batchStatus.currentBatch}/{batchStatus.totalBatches} batches)
                  </Typography>
                  <LinearProgress 
                    variant="determinate" 
                    value={parseInt(batchStatus.progress)} 
                    color="warning"
                    sx={{ height: 8, borderRadius: 4 }}
                  />
                </Box>

                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mb: 2 }}>
                  <Chip 
                    label={`${batchStatus.stats?.updatedJobs || 0} updated`} 
                    color="success" 
                    size="small" 
                  />
                  <Chip 
                    label={`${batchStatus.stats?.deletedJobs || 0} deleted`} 
                    color="error" 
                    size="small" 
                  />
                  <Chip 
                    label={`${batchStatus.stats?.failedUpdates || 0} failed`} 
                    color="error" 
                    size="small" 
                  />
                  <Chip 
                    label={`${batchStatus.processedJobs || 0}/${batchStatus.totalJobs || 0} jobs`} 
                    color="info" 
                    size="small" 
                  />
                </Box>

                {batchStatus.timing?.nextBatchTime && (
                  <Typography variant="body2" color="text.secondary" gutterBottom>
                    Next batch: {new Date(batchStatus.timing.nextBatchTime).toLocaleString()}
                  </Typography>
                )}

                <Box sx={{ display: 'flex', gap: 1 }}>
                  {batchStatus.status === 'running' && (
                    <Button
                      variant="outlined"
                      color="error"
                      onClick={handleStopBatch}
                      disabled={stoppingBatch}
                      startIcon={stoppingBatch ? <Refresh /> : <Stop />}
                      size="small"
                    >
                      {stoppingBatch ? 'Stopping...' : 'Stop Batch'}
                    </Button>
                  )}
                  {batchStatus.status === 'stopped' && (
                    <Button
                      variant="outlined"
                      color="success"
                      onClick={handleResumeBatch}
                      disabled={resumingBatch}
                      startIcon={resumingBatch ? <Refresh /> : <PlayArrow />}
                      size="small"
                    >
                      {resumingBatch ? 'Resuming...' : 'Resume Batch'}
                    </Button>
                  )}
                  <Button
                    variant="outlined"
                    color="info"
                    onClick={checkBatchStatus}
                    size="small"
                  >
                    Refresh Status
                  </Button>
                </Box>
              </CardContent>
            </Card>
          )}

          {!selectedAccount.workizApiToken && (
            <Alert severity="warning">
              Please add a Workiz API token to the selected account to sync jobs.
            </Alert>
          )}
          {!selectedAccount.googleSheetsId && (
            <Alert severity="warning">
              Please add a Google Sheet ID to sync jobs to Google Sheets.
            </Alert>
          )}
          <Alert severity="info" sx={{ mb: 2 }}>
            <AlertTitle>Automated Sync</AlertTitle>
            Jobs are automatically synced daily at 9:00 AM UTC via Vercel Cron Jobs. 
            Use the manual sync buttons above for immediate updates.
            <br /><br />
            <strong>Sync Jobs:</strong> Fast bulk sync from Workiz API
            <br />
            <strong>Update & Cleanup Jobs:</strong> Detailed batch processing to update existing jobs and remove old ones (&gt;1 year)
          </Alert>
          {error && <Alert severity="error">{error}</Alert>}
          
          {/* Sync History Section */}
          {selectedAccount.id && (
            <SyncHistoryComponent 
              accountId={selectedAccount.id} 
              accountTimezone={selectedAccount.timezone}
              refreshTrigger={refreshSyncHistory}
            />
          )}
        </>
      )}
    </Box>
  );
};

export default JobList;