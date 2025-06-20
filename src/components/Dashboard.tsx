import React, { useState, useEffect } from 'react';
import { Box, Grid, Paper, Typography } from '@mui/material';
import AccountForm from './AccountForm';
import AccountList from './AccountList';
import JobList from './JobList';
import { Account } from '../types';

const Dashboard: React.FC = () => {
  const [accounts, setAccounts] = useState<Account[]>([]);

  useEffect(() => {
    // Fetch accounts from your API
    const fetchAccounts = async () => {
      try {
        const response = await fetch('http://localhost:3000/api/accounts');
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
        const response = await fetch('http://localhost:3000/api/accounts');
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
      
      <Grid container spacing={3}>
        <Grid item xs={12} md={6}>
          <Paper sx={{ p: 2 }}>
            <Typography variant="h6" gutterBottom>
              Account Configuration
            </Typography>
            <AccountForm onAccountAdded={handleAccountsChange} />
          </Paper>
        </Grid>
        <Grid item xs={12} md={6}>
          <Paper sx={{ p: 2 }}>
            <Typography variant="h6" gutterBottom>
              Accounts
            </Typography>
            <AccountList accounts={accounts} onAccountsChange={handleAccountsChange} />
          </Paper>
        </Grid>
        <Grid item xs={12}>
          <Paper sx={{ p: 2 }}>
            <Typography variant="h6" gutterBottom>
              Jobs
            </Typography>
            <JobList accounts={accounts} />
          </Paper>
        </Grid>
      </Grid>
    </Box>
  );
};

export default Dashboard; 