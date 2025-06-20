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
} from '@mui/material';
import { Account } from '../types/index';

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
  const [jobs, setJobs] = useState<Job[]>([]);
  const [allJobs, setAllJobs] = useState<Job[]>([]); // Store all jobs for counting
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>('');
  const [syncing, setSyncing] = useState(false);
  const [syncingToSheets, setSyncingToSheets] = useState(false);

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
        const response = await fetch('http://localhost:3000/api/jobs');
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

  // Filter jobs for selected account
  useEffect(() => {
    if (!selectedAccount?.id) {
      setJobs([]);
      return;
    }
    
    setLoading(true);
    // Filter jobs for the selected account from allJobs using accountId
    const filtered = allJobs.filter((job: Job) => String(job.accountId) === String(selectedAccount.id));
    setJobs(filtered);
    setLoading(false);
  }, [selectedAccount, allJobs]);

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
        `http://localhost:3000/api/sync-jobs/${selectedAccount.id}`,
        { method: 'POST' }
      );
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to sync jobs');
      }
      // After sync, reload jobs
      setSyncing(false);
      setLoading(true);
      // Trigger jobs reload
      setTimeout(() => setSyncing(false), 100); // force useEffect
    } catch (err) {
      console.error('Sync error:', err);
      setError(err instanceof Error ? err.message : 'Failed to sync jobs');
      setSyncing(false);
    }
  };

  const handleSyncToSheets = async () => {
    if (!selectedAccount?.id) return;
    setSyncingToSheets(true);
    setError('');
    try {
      const response = await fetch(
        `http://localhost:3000/api/sync-to-sheets/${selectedAccount.id}`,
        { method: 'POST' }
      );
      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error || 'Failed to sync to Google Sheets');
      }
      
      console.log('Sync to sheets successful:', data);
    } catch (err) {
      console.error('Sync to sheets error:', err);
      setError(err instanceof Error ? err.message : 'Failed to sync to Google Sheets');
    } finally {
      setSyncingToSheets(false);
    }
  };

  const filteredJobs = jobs.filter((job) => {
    if (!selectedAccount?.sourceFilter || !Array.isArray(selectedAccount.sourceFilter) || selectedAccount.sourceFilter.length === 0) {
      return true;
    }
    return selectedAccount.sourceFilter.includes(job.JobSource);
  });

  const renderAccountInfo = (account: Account) => {
    const sourceFilterText = Array.isArray(account.sourceFilter) && account.sourceFilter.length > 0
      ? account.sourceFilter.join(', ')
      : 'All sources';
    
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
              disabled={syncing || loading}
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
        </>
      )}
    </Box>
  );
};

export default JobList;