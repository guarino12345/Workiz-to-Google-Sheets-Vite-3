import React, { useState } from 'react';
import {
  Box,
  Typography,
  List,
  ListItem,
  ListItemText,
  IconButton,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Alert,
  CircularProgress,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  FormControlLabel,
  Switch,
  Card,
  CardContent,
  Chip,
  AlertTitle,
} from '@mui/material';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import RefreshIcon from '@mui/icons-material/Refresh';
import { Account } from '../types/index';
import { buildApiUrl } from '../utils/api';
import { timezoneOptions, getTimezoneLabel } from '../utils/timezone';

interface AccountListProps {
  accounts: Account[];
  onAccountsChange: () => void;
}

const AccountList: React.FC<AccountListProps> = ({ accounts, onAccountsChange }) => {
  const [editingAccount, setEditingAccount] = useState<Account | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<'source' | 'date'>('source');

  const handleDelete = async (account: Account) => {
    if (!confirm('Are you sure you want to delete this account?')) return;

    try {
      setLoading(true);
      const accountId = account.id || account._id;
      if (!accountId) {
        throw new Error('Account ID not found');
      }

      const response = await fetch(buildApiUrl(`/api/accounts/${accountId}`), {
        method: 'DELETE',
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Failed to delete account');
      }

      onAccountsChange();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete account');
    } finally {
      setLoading(false);
    }
  };

  const handleEdit = (account: Account) => {
    setEditingAccount({ ...account });
  };

  const handleSave = async () => {
    if (!editingAccount) return;

    try {
      setLoading(true);
      const accountId = editingAccount.id || editingAccount._id;
      if (!accountId) {
        throw new Error('Account ID not found');
      }

      const response = await fetch(buildApiUrl(`/api/accounts/${accountId}`), {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: editingAccount.name,
          sourceFilter: editingAccount.sourceFilter,
          googleSheetsId: editingAccount.googleSheetsId,
          whatconvertsApiKey: editingAccount.whatconvertsApiKey,
          whatconvertsApiSecret: editingAccount.whatconvertsApiSecret,
          defaultConversionValue: editingAccount.defaultConversionValue,
          timezone: editingAccount.timezone,
          syncEnabled: editingAccount.syncEnabled,
          syncFrequency: editingAccount.syncFrequency,
          syncTime: editingAccount.syncTime,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Failed to update account');
      }

      onAccountsChange();
      setEditingAccount(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update account');
    } finally {
      setLoading(false);
    }
  };

  const handleCancel = () => {
    setEditingAccount(null);
  };

  const handleSourceFilterChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!editingAccount) return;
    setEditingAccount({
      ...editingAccount,
      sourceFilter: [e.target.value],
    });
  };

  const handleGoogleSheetsIdChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!editingAccount) return;
    setEditingAccount({
      ...editingAccount,
      googleSheetsId: e.target.value,
    });
  };

  const handleDefaultConversionValueChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!editingAccount) return;
    setEditingAccount({
      ...editingAccount,
      defaultConversionValue: parseFloat(e.target.value) || 0,
    });
  };

  const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!editingAccount) return;
    setEditingAccount({
      ...editingAccount,
      name: e.target.value,
    });
  };

  const getSourceFilter = (account: Account) => {
    return Array.isArray(account.sourceFilter) 
      ? account.sourceFilter.join(', ') 
      : account.sourceFilter || '';
  };

  const sortedAccounts = [...accounts].sort((a, b) => {
    if (sortBy === 'source') {
      return getSourceFilter(a).localeCompare(getSourceFilter(b));
    }
    return 0; // Default sort order if not by source
  });

  return (
    <Box sx={{ mt: 2 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Typography variant="h6" component="div">
          Saved Accounts
        </Typography>
        <Box>
          <FormControl sx={{ minWidth: 120, mr: 2 }}>
            <InputLabel>Sort By</InputLabel>
            <Select
              value={sortBy}
              label="Sort By"
              onChange={(e) => setSortBy(e.target.value as 'source' | 'date')}
              size="small"
            >
              <MenuItem value="source">Source</MenuItem>
              <MenuItem value="date">Date</MenuItem>
            </Select>
          </FormControl>
          <Button
            variant="contained"
            startIcon={<RefreshIcon />}
            onClick={onAccountsChange}
            disabled={loading}
          >
            Refresh
          </Button>
        </Box>
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {loading && (
        <Box sx={{ display: 'flex', justifyContent: 'center', my: 2 }}>
          <CircularProgress />
        </Box>
      )}

      <List>
        {sortedAccounts.map((account) => (
          <ListItem
            key={account.id || account._id}
            secondaryAction={
              <Box>
                <IconButton
                  edge="end"
                  aria-label="edit"
                  onClick={() => handleEdit(account)}
                  disabled={loading}
                >
                  <EditIcon />
                </IconButton>
                <IconButton
                  edge="end"
                  aria-label="delete"
                  onClick={() => handleDelete(account)}
                  disabled={loading}
                >
                  <DeleteIcon />
                </IconButton>
              </Box>
            }
          >
            <ListItemText
              primary={account.name || 'Unnamed Account'}
              secondary={
                <>
                  <Typography component="span" variant="body2" color="text.primary">
                    Source Filter: {getSourceFilter(account)}
                  </Typography>
                  <br />
                  <Typography component="span" variant="body2" color="text.secondary">
                    Default Conversion Value: ${account.defaultConversionValue}
                  </Typography>
                  <br />
                  <Typography component="span" variant="body2" color="text.secondary">
                    Timezone: {getTimezoneLabel(account.timezone || 'America/Los_Angeles')}
                  </Typography>
                  <br />
                  <Typography component="span" variant="body2" color="text.secondary">
                    Auto Sync: {account.syncEnabled ? 'Enabled' : 'Disabled'}
                    {account.syncEnabled && ` (${account.syncFrequency} at ${account.syncTime})`}
                  </Typography>
                  <br />
                  <Typography component="span" variant="body2" color="text.secondary">
                    WhatConverts: {account.whatconvertsApiKey && account.whatconvertsApiSecret ? '✅ Configured' : '❌ Not configured'}
                  </Typography>
                </>
              }
            />
          </ListItem>
        ))}
      </List>

      <Dialog open={!!editingAccount} onClose={handleCancel} maxWidth="sm" fullWidth>
        <DialogTitle>Edit Account</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            margin="dense"
            label="Account Name"
            fullWidth
            value={editingAccount?.name || ''}
            onChange={handleNameChange}
            sx={{ mb: 2 }}
          />
          <TextField
            margin="dense"
            label="Source Filter"
            fullWidth
            value={Array.isArray(editingAccount?.sourceFilter) ? editingAccount?.sourceFilter.join(', ') : editingAccount?.sourceFilter || ''}
            onChange={handleSourceFilterChange}
            sx={{ mb: 2 }}
          />
          <TextField
            margin="dense"
            label="Google Sheets ID"
            fullWidth
            value={editingAccount?.googleSheetsId || ''}
            onChange={handleGoogleSheetsIdChange}
            sx={{ mb: 2 }}
          />
          <FormControl fullWidth margin="dense" sx={{ mb: 2 }}>
            <InputLabel>Timezone</InputLabel>
            <Select
              value={editingAccount?.timezone || 'America/Los_Angeles'}
              label="Timezone"
              onChange={(e) => setEditingAccount(editingAccount ? {
                ...editingAccount,
                timezone: e.target.value
              } : null)}
            >
              {timezoneOptions.map((option) => (
                <MenuItem key={option.value} value={option.value}>
                  {option.label}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <TextField
            margin="dense"
            label="WhatConverts API Key (Optional)"
            fullWidth
            value={editingAccount?.whatconvertsApiKey || ''}
            onChange={(e) => setEditingAccount(editingAccount ? {
              ...editingAccount,
              whatconvertsApiKey: e.target.value
            } : null)}
            sx={{ mb: 2 }}
            helperText="WhatConverts API Key (token) - if provided, jobs will only be synced if the phone number exists in WhatConverts leads"
          />
          <TextField
            margin="dense"
            label="WhatConverts API Secret (Optional)"
            fullWidth
            type="password"
            value={editingAccount?.whatconvertsApiSecret || ''}
            onChange={(e) => setEditingAccount(editingAccount ? {
              ...editingAccount,
              whatconvertsApiSecret: e.target.value
            } : null)}
            sx={{ mb: 2 }}
            helperText="WhatConverts API Secret - required if API Key is provided"
          />
          <TextField
            margin="dense"
            label="Default Conversion Value"
            type="number"
            fullWidth
            value={editingAccount?.defaultConversionValue || 0}
            onChange={handleDefaultConversionValueChange}
            sx={{ mb: 2 }}
          />
          
          {/* Scheduling Section */}
          <Typography variant="h6" gutterBottom sx={{ mt: 3, mb: 2 }}>
            Automated Sync Settings
          </Typography>

          <FormControlLabel
            control={
              <Switch
                checked={editingAccount?.syncEnabled || false}
                onChange={(e) => setEditingAccount(editingAccount ? {
                  ...editingAccount,
                  syncEnabled: e.target.checked
                } : null)}
              />
            }
            label="Enable Automated Syncing"
            sx={{ mb: 2 }}
          />

          {editingAccount?.syncEnabled && (
            <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
              <FormControl sx={{ minWidth: 200, flex: 1 }}>
                <InputLabel>Sync Frequency</InputLabel>
                <Select
                  value={editingAccount?.syncFrequency || 'daily'}
                  label="Sync Frequency"
                  onChange={(e) => setEditingAccount(editingAccount ? {
                    ...editingAccount,
                    syncFrequency: e.target.value as any
                  } : null)}
                >
                  <MenuItem value="daily">Daily</MenuItem>
                  <MenuItem value="weekly">Weekly</MenuItem>
                  <MenuItem value="monthly">Monthly</MenuItem>
                  <MenuItem value="custom">Custom</MenuItem>
                </Select>
              </FormControl>
              <TextField
                sx={{ minWidth: 200, flex: 1 }}
                label="Sync Time"
                type="time"
                value={editingAccount?.syncTime || '09:00'}
                onChange={(e) => setEditingAccount(editingAccount ? {
                  ...editingAccount,
                  syncTime: e.target.value
                } : null)}
                InputLabelProps={{ shrink: true }}
                helperText="Time to run sync (24-hour format)"
              />
            </Box>
          )}

          <Alert severity="info" sx={{ mt: 3, mb: 2 }}>
            <AlertTitle>Automated Sync</AlertTitle>
            Automated syncing is handled by Vercel Cron Jobs running daily at 9:00 AM UTC. 
            Manual sync options are available in the Jobs section.
          </Alert>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCancel}>Cancel</Button>
          <Button onClick={handleSave} disabled={loading}>
            {loading ? <CircularProgress size={24} /> : 'Save'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default AccountList; 