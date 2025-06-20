import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  List,
  ListItem,
  Chip,
  Collapse,
  IconButton,
  Alert,
  CircularProgress,
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ErrorIcon from '@mui/icons-material/Error';
import { SyncHistory } from '../types/index';
import { buildApiUrl } from '../utils/api';

interface SyncHistoryProps {
  accountId: string;
  refreshTrigger?: number;
}

const SyncHistoryComponent: React.FC<SyncHistoryProps> = ({ accountId, refreshTrigger }) => {
  const [syncHistory, setSyncHistory] = useState<SyncHistory[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>('');
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());

  useEffect(() => {
    const fetchSyncHistory = async () => {
      if (!accountId) return;
      
      setLoading(true);
      setError('');
      try {
        const response = await fetch(buildApiUrl(`/api/sync-history/${accountId}`));
        if (!response.ok) {
          throw new Error('Failed to fetch sync history');
        }
        const data = await response.json();
        setSyncHistory(data);
      } catch (err) {
        console.error('Failed to fetch sync history:', err);
        setError(err instanceof Error ? err.message : 'Failed to fetch sync history');
      } finally {
        setLoading(false);
      }
    };

    fetchSyncHistory();
  }, [accountId, refreshTrigger]);

  const handleToggleExpand = (syncId: string) => {
    const newExpanded = new Set(expandedItems);
    if (newExpanded.has(syncId)) {
      newExpanded.delete(syncId);
    } else {
      newExpanded.add(syncId);
    }
    setExpandedItems(newExpanded);
  };

  const formatTimestamp = (timestamp: string | Date) => {
    const date = new Date(timestamp);
    return date.toLocaleString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  };

  const getStatusIcon = (status: string) => {
    return status === 'success' ? (
      <CheckCircleIcon color="success" fontSize="small" />
    ) : (
      <ErrorIcon color="error" fontSize="small" />
    );
  };

  const getStatusChip = (status: string) => {
    return (
      <Chip
        label={status === 'success' ? 'Success' : 'Error'}
        color={status === 'success' ? 'success' : 'error'}
        size="small"
        icon={getStatusIcon(status)}
      />
    );
  };

  const getSyncTypeLabel = (syncType: string) => {
    return syncType === 'jobs' ? 'Jobs Sync' : 'Google Sheets Sync';
  };

  const renderSyncDetails = (sync: SyncHistory) => {
    if (sync.syncType === 'jobs') {
      return (
        <Box sx={{ mt: 1 }}>
          <Typography variant="body2" color="text.secondary">
            Jobs from Workiz: {sync.details.jobsFromWorkiz || 0}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Existing jobs found: {sync.details.existingJobsFound || 0}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Final job count: {sync.details.finalJobCount || 0}
          </Typography>
        </Box>
      );
    } else if (sync.syncType === 'sheets') {
      return (
        <Box sx={{ mt: 1 }}>
          <Typography variant="body2" color="text.secondary">
            Total jobs: {sync.details.totalJobs || 0}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Filtered jobs: {sync.details.filteredJobs || 0}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Updated rows: {sync.details.updatedRows || 0}
          </Typography>
          {sync.details.sampleJobSources && sync.details.sampleJobSources.length > 0 && (
            <Typography variant="body2" color="text.secondary">
              Sample sources: {sync.details.sampleJobSources.join(', ')}
            </Typography>
          )}
        </Box>
      );
    }
    return null;
  };

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', my: 2 }}>
        <CircularProgress />
      </Box>
    );
  }

  if (error) {
    return (
      <Alert severity="error" sx={{ mb: 2 }}>
        {error}
      </Alert>
    );
  }

  if (syncHistory.length === 0) {
    return (
      <Alert severity="info" sx={{ mb: 2 }}>
        No sync history available for this account.
      </Alert>
    );
  }

  return (
    <Box sx={{ mt: 2 }}>
      <Typography variant="h6" gutterBottom>
        Sync History
      </Typography>
      <List>
        {syncHistory.map((sync) => (
          <ListItem
            key={sync.id}
            sx={{
              border: 1,
              borderColor: 'divider',
              borderRadius: 1,
              mb: 1,
              flexDirection: 'column',
              alignItems: 'stretch',
            }}
          >
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                {getStatusChip(sync.status)}
                <Typography variant="body2" color="text.primary">
                  {getSyncTypeLabel(sync.syncType)}
                </Typography>
              </Box>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Typography variant="body2" color="text.secondary">
                  {formatTimestamp(sync.timestamp)}
                </Typography>
                <IconButton
                  size="small"
                  onClick={() => handleToggleExpand(sync.id || '')}
                >
                  {expandedItems.has(sync.id || '') ? <ExpandLessIcon /> : <ExpandMoreIcon />}
                </IconButton>
              </Box>
            </Box>
            
            <Collapse in={expandedItems.has(sync.id || '')} timeout="auto" unmountOnExit>
              <Box sx={{ mt: 2, pt: 2, borderTop: 1, borderColor: 'divider' }}>
                {sync.errorMessage && (
                  <Alert severity="error" sx={{ mb: 2 }}>
                    {sync.errorMessage}
                  </Alert>
                )}
                {renderSyncDetails(sync)}
              </Box>
            </Collapse>
          </ListItem>
        ))}
      </List>
    </Box>
  );
};

export default SyncHistoryComponent; 