import React, { useState, useEffect } from 'react';
import { Box, Paper, Typography } from '@mui/material';
import AccountForm from './AccountForm';
import AccountList from './AccountList';
import JobList from './JobList';
import { Account } from '../types/index';
import { buildApiUrl } from '../utils/api';

const Dashboard: React.FC = () => {
  const [accounts, setAccounts] = useState<Account[]>([]);

  useEffect(() => {
    // Fetch accounts from your API
    const fetchAccounts = async () => {
      try {
        const response = await fetch(buildApiUrl('/api/accounts'));
        if (!response.ok) {
          throw new Error('Failed to fetch accounts');
        }
        const data = await response.json();
        setAccounts(data);
      } catch (error) {
        console.error('Error fetching accounts:', error);
      }
    };

    fetchAccounts();
  }, []);

  const handleAccountsChange = () => {
    // Refetch accounts when changes occur
    const fetchAccounts = async () => {
      try {
        const response = await fetch(buildApiUrl('/api/accounts'));
        if (!response.ok) {
          throw new Error('Failed to fetch accounts');
        }
        const data = await response.json();
        setAccounts(data);
      } catch (error) {
        console.error('Error fetching accounts:', error);
      }
    };

    fetchAccounts();
  };

  return (
    <Box sx={{ flexGrow: 1, p: 3 }}>
      <Typography variant="h4" gutterBottom>
        Workiz Sync Dashboard
      </Typography>
      
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        <Box sx={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
          <Paper sx={{ p: 2, flex: 1, minWidth: 300 }}>
            <Typography variant="h6" gutterBottom>
              Account Configuration
            </Typography>
            <AccountForm onSuccess={handleAccountsChange} />
          </Paper>
          <Paper sx={{ p: 2, flex: 1, minWidth: 300 }}>
            <Typography variant="h6" gutterBottom>
              Accounts
            </Typography>
            <AccountList accounts={accounts} onAccountsChange={handleAccountsChange} />
          </Paper>
        </Box>
        <Paper sx={{ p: 2 }}>
          <Typography variant="h6" gutterBottom>
            Jobs
          </Typography>
          <JobList accounts={accounts} />
        </Paper>
      </Box>
    </Box>
  );
};

export default Dashboard; 