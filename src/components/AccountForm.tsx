import React, { useState } from 'react';
import {
  Box,
  TextField,
  Button,
  Typography,
  Alert,
  CircularProgress,
} from '@mui/material';
import { Account } from '../types';

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
      const response = await fetch('http://localhost:3000/api/accounts', {
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