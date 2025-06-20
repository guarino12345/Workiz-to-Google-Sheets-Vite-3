import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Alert,
  Button,
  Link,
} from '@mui/material';
import { Account } from '../types/index';
import { buildApiUrl } from '../utils/api';
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

interface JobListProps {
  accounts: Account[];
}

const JobList: React.FC<JobListProps> = ({ accounts }) => {
  const [selectedAccount, setSelectedAccount] = useState<Account | null>(null);
  const [allJobs, setAllJobs] = useState<Job[]>([]); // Store all jobs for counting
  const [error, setError] = useState<string>('');
  const [syncing, setSyncing] = useState(false);
  const [syncingToSheets, setSyncingToSheets] = useState(false);
  const [refreshSyncHistory, setRefreshSyncHistory] = useState(0);
  const [manualTriggering, setManualTriggering] = useState(false);

  // Set initial selected account only once when component mounts
  useEffect(() => {
    if (accounts.length > 0 && !selectedAccount) {
      setSelectedAccount(accounts[0]);
    }
  }, []);

  // Fetch ALL jobs from DB when component mounts or accounts change
  useEffect(() => {
    const fetchAllJobs = async () => {
      if (accounts.length === 0) return;
      try {
        const response = await fetch(buildApiUrl('/api/jobs'));
        if (!response.ok) throw new Error('Failed to fetch jobs from DB');
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

  const handleSync = async () => {
    if (!selectedAccount?.id) {
      console.error('No account ID available for sync');
      return;
    }
    setSyncing(true);
    setError('');
    try {
      console.log('Syncing jobs for account:', selectedAccount.id);
      const response = await fetch(
        buildApiUrl(`/api/sync-jobs/${selectedAccount.id}`),
        { method: 'POST' }
      );
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to sync jobs');
      }
      
      // After successful sync, refresh sync history
      setRefreshSyncHistory(prev => prev + 1);
      
      // Reload jobs by triggering the useEffect
      const jobsResponse = await fetch(buildApiUrl('/api/jobs'));
      if (jobsResponse.ok) {
        const jobsData = await jobsResponse.json();
        setAllJobs(jobsData);
      }
      
    } catch (err) {
      console.error('Sync error:', err);
      setError(err instanceof Error ? err.message : 'Failed to sync jobs');
    } finally {
      setSyncing(false);
    }
  };

  const handleSyncToSheets = async () => {
    if (!selectedAccount?.id) return;
    setSyncingToSheets(true);
    setError('');
    try {
      const response = await fetch(
        buildApiUrl(`/api/sync-to-sheets/${selectedAccount.id}`),
        { method: 'POST' }
      );
      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error || 'Failed to sync to Google Sheets');
      }
      
      console.log('Sync to sheets successful:', data);
      setRefreshSyncHistory(prev => prev + 1); // Trigger sync history refresh
    } catch (err) {
      console.error('Sync to sheets error:', err);
      setError(err instanceof Error ? err.message : 'Failed to sync to Google Sheets');
    } finally {
      setSyncingToSheets(false);
    }
  };

  const handleManualTrigger = async () => {
    if (!selectedAccount?.id) return;
    setManualTriggering(true);
    setError('');
    try {
      const response = await fetch(
        buildApiUrl(`/api/trigger-sync/${selectedAccount.id}`),
        { method: 'POST' }
      );
      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error || 'Failed to trigger manual sync');
      }
      
      console.log('Manual trigger successful:', data);
      setRefreshSyncHistory(prev => prev + 1); // Trigger sync history refresh
      
      // Reload jobs
      const jobsResponse = await fetch(buildApiUrl('/api/jobs'));
      if (jobsResponse.ok) {
        const jobsData = await jobsResponse.json();
        setAllJobs(jobsData);
      }
      
    } catch (err) {
      console.error('Manual trigger error:', err);
      setError(err instanceof Error ? err.message : 'Failed to trigger manual sync');
    } finally {
      setManualTriggering(false);
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
          <Box sx={{ display: 'flex', gap: 2, mb: 2 }}>
            <Button
              variant="contained"
              color="primary"
              onClick={handleSync}
              disabled={syncing}
            >
              {syncing ? 'Syncing...' : 'Sync Jobs'}
            </Button>
            <Button
              variant="contained"
              color="secondary"
              onClick={handleSyncToSheets}
              disabled={syncingToSheets || !selectedAccount.googleSheetsId}
            >
              {syncingToSheets ? 'Syncing to Sheets...' : 'Sync to Google Sheets'}
            </Button>
            {selectedAccount.syncEnabled && (
              <Button
                variant="outlined"
                color="info"
                onClick={handleManualTrigger}
                disabled={manualTriggering}
              >
                {manualTriggering ? 'Triggering...' : 'Test Auto Sync'}
              </Button>
            )}
          </Box>
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
          {error && <Alert severity="error">{error}</Alert>}
          
          {/* Sync History Section */}
          {selectedAccount.id && (
            <SyncHistoryComponent 
              accountId={selectedAccount.id} 
              refreshTrigger={refreshSyncHistory}
            />
          )}
        </>
      )}
    </Box>
  );
};

export default JobList;