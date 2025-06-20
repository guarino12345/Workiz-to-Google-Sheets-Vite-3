// Account configuration types
export interface Account {
  id?: string;
  _id?: string;
  name: string;
  workizApiToken: string;
  googleSheetsId: string;
  sourceFilter: string[];
  defaultConversionValue: number;
  // New scheduling fields
  syncEnabled: boolean;
  syncFrequency: 'daily' | 'weekly' | 'monthly' | 'custom';
  syncTime: string; // HH:MM format
  lastSyncDate?: Date;
  nextSyncDate?: Date;
  createdAt?: Date;
  updatedAt?: Date;
}

// Job types
export interface Job {
  UUID: string;
  JobDateTime: string;
  Status: string;
  JobSource: string;
  JobTotalPrice: number;
  accountId?: string;
}

// Sync history types
export interface SyncHistory {
  id?: string;
  _id?: string;
  accountId: string;
  syncType: 'jobs' | 'sheets';
  status: 'success' | 'error';
  timestamp: Date;
  details: {
    jobsFromWorkiz?: number;
    existingJobsFound?: number;
    finalJobCount?: number;
    totalJobs?: number;
    filteredJobs?: number;
    updatedRows?: number;
    sourceFilter?: string[];
    sampleJobSources?: string[];
  };
  errorMessage?: string;
  createdAt?: Date;
}

// Sync status types
export interface SyncStatus {
  lastSync: Date;
  status: 'idle' | 'syncing' | 'error';
  error?: string;
} 