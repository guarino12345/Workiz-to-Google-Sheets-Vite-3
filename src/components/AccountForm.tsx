import React, { useState } from 'react';
import {
  Box,
  TextField,
  Button,
  Typography,
  Alert,
  CircularProgress,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  FormControlLabel,
  Switch,
  AlertTitle,
} from '@mui/material';
import { Account } from '../types/index';
import { buildApiUrl } from '../utils/api';

interface AccountFormProps {
  onSuccess: () => void;
}

const AccountForm: React.FC<AccountFormProps> = ({ onSuccess }) => {
  const [formData, setFormData] = useState<Partial<Account>>({
    workizApiToken: '',
    googleSheetsId: '',
    sourceFilter: [],
    defaultConversionValue: 0,
    name: '',
    syncEnabled: false,
    syncFrequency: 'daily',
    syncTime: '09:00',
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.workizApiToken || !formData.googleSheetsId || !formData.name) {
      setError('Please fill in all required fields');
      return;
    }

    try {
      setLoading(true);
      setError('');
      const response = await fetch(buildApiUrl('/api/accounts'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(formData),
      });

      if (!response.ok) {
        throw new Error('Failed to add account');
      }

      setFormData({
        workizApiToken: '',
        googleSheetsId: '',
        sourceFilter: [],
        defaultConversionValue: 0,
        name: '',
        syncEnabled: false,
        syncFrequency: 'daily',
        syncTime: '09:00',
      });
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Box component="form" onSubmit={handleSubmit} sx={{ mt: 2 }}>
      <Typography variant="h6" gutterBottom>
        Add New Account
      </Typography>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      <TextField
        fullWidth
        label="Account Name"
        value={formData.name}
        onChange={(e) => setFormData({ ...formData, name: e.target.value })}
        margin="normal"
        required
      />

      <TextField
        fullWidth
        label="Workiz API Token"
        value={formData.workizApiToken}
        onChange={(e) => setFormData({ ...formData, workizApiToken: e.target.value })}
        margin="normal"
        required
      />

      <TextField
        fullWidth
        label="Google Sheets ID"
        value={formData.googleSheetsId}
        onChange={(e) => setFormData({ ...formData, googleSheetsId: e.target.value })}
        margin="normal"
        required
      />

      <TextField
        fullWidth
        label="Source Filter (comma-separated)"
        value={Array.isArray(formData.sourceFilter) ? formData.sourceFilter.join(', ') : ''}
        onChange={(e) => setFormData({ ...formData, sourceFilter: e.target.value.split(',').map(s => s.trim()) })}
        margin="normal"
        helperText="Enter sources separated by commas (e.g., Google, GMB)"
      />

      <TextField
        fullWidth
        label="Default Conversion Value"
        type="number"
        value={formData.defaultConversionValue}
        onChange={(e) => setFormData({ ...formData, defaultConversionValue: Number(e.target.value) })}
        margin="normal"
        InputProps={{ inputProps: { min: 0 } }}
      />

      {/* Scheduling Section */}
      <Typography variant="h6" gutterBottom sx={{ mt: 3, mb: 2 }}>
        Automated Sync Settings
      </Typography>

      <FormControlLabel
        control={
          <Switch
            checked={formData.syncEnabled || false}
            onChange={(e) => setFormData({ ...formData, syncEnabled: e.target.checked })}
          />
        }
        label="Enable Automated Syncing"
        sx={{ mb: 2 }}
      />

      {formData.syncEnabled && (
        <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
          <FormControl sx={{ minWidth: 200, flex: 1 }}>
            <InputLabel>Sync Frequency</InputLabel>
            <Select
              value={formData.syncFrequency || 'daily'}
              label="Sync Frequency"
              onChange={(e) => setFormData({ ...formData, syncFrequency: e.target.value as any })}
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
            value={formData.syncTime || '09:00'}
            onChange={(e) => setFormData({ ...formData, syncTime: e.target.value })}
            margin="normal"
            InputLabelProps={{ shrink: true }}
            helperText="Time to run sync (24-hour format)"
          />
        </Box>
      )}

      {/* Automated Sync Settings - DISABLED (Using Vercel Cron Job at 9am UTC)
      <FormControlLabel
        control={
          <Switch
            checked={formData.syncEnabled || false}
            onChange={(e) => setFormData({ ...formData, syncEnabled: e.target.checked })}
          />
        }
        label="Enable Automated Syncing"
        sx={{ mb: 2 }}
      />

      {formData.syncEnabled && (
        <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
          <FormControl sx={{ minWidth: 200, flex: 1 }}>
            <InputLabel>Sync Frequency</InputLabel>
            <Select
              value={formData.syncFrequency || 'daily'}
              label="Sync Frequency"
              onChange={(e) => setFormData({ ...formData, syncFrequency: e.target.value as any })}
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
            value={formData.syncTime || '09:00'}
            onChange={(e) => setFormData({ ...formData, syncTime: e.target.value })}
            margin="normal"
            InputLabelProps={{ shrink: true }}
            helperText="Time to run sync (24-hour format)"
          />
        </Box>
      )}
      */}

      <Alert severity="info" sx={{ mb: 2 }}>
        <AlertTitle>Automated Sync</AlertTitle>
        Automated syncing is handled by Vercel Cron Jobs running daily at 9:00 AM UTC. 
        Manual sync options are available in the Jobs section.
      </Alert>

      <Button
        type="submit"
        variant="contained"
        color="primary"
        fullWidth
        disabled={loading}
        sx={{ mt: 2 }}
      >
        {loading ? <CircularProgress size={24} /> : 'Add Account'}
      </Button>
    </Box>
  );
};

export default AccountForm; 