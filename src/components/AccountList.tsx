import React, { useState, useEffect } from 'react';
import {
  List,
  ListItem,
  ListItemText,
  IconButton,
  Typography,
  Box,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Alert,
  CircularProgress,
  Chip,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
} from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import EditIcon from '@mui/icons-material/Edit';
import RefreshIcon from '@mui/icons-material/Refresh';
import { Account } from '../types';

interface AccountListProps {
  accounts: Account[];
  onAccountsChange: () => void;
}

const AccountList: React.FC<AccountListProps> = ({ accounts, onAccountsChange }) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingAccount, setEditingAccount] = useState<Account | null>(null);
  const [sortBy, setSortBy] = useState<'source' | 'date'>('source');

  const handleDelete = async (account: Account) => {
    const accountId = account.id || account._id;
    if (!accountId) {
      setError('Invalid account ID');
      return;
    }

    if (!window.confirm('Are you sure you want to delete this account?')) {
      return;
    }

    try {
      setLoading(true);
      const response = await fetch(`http://localhost:3000/api/accounts/${accountId}`, {
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
    const accountId = account.id || account._id;
    if (!accountId) {
      setError('Invalid account ID');
      return;
    }
    setEditingAccount({
      ...account,
      id: accountId,
      sourceFilter: Array.isArray(account.sourceFilter) ? account.sourceFilter : [account.sourceFilter || '']
    });
  };

  const handleSave = async () => {
    if (!editingAccount) {
      setError('No account selected for editing');
      return;
    }

    const accountId = editingAccount.id || editingAccount._id;
    if (!accountId) {
      setError('Invalid account ID');
      return;
    }

    try {
      setLoading(true);
      const { id, _id, ...updateData } = editingAccount;
      const response = await fetch(`http://localhost:3000/api/accounts/${accountId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ...updateData,
          sourceFilter: Array.isArray(editingAccount.sourceFilter) 
            ? editingAccount.sourceFilter 
            : [editingAccount.sourceFilter || ''],
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
          <TextField
            margin="dense"
            label="Default Conversion Value"
            type="number"
            fullWidth
            value={editingAccount?.defaultConversionValue || 0}
            onChange={handleDefaultConversionValueChange}
          />
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