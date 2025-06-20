// Account configuration types
export interface Account {
  id?: string;
  _id?: string;
  name: string;
  workizApiToken: string;
  googleSheetsId: string;
  sourceFilter: string[];
  defaultConversionValue: number;
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
}

// Sync status types
export interface SyncStatus {
  lastSync: Date;
  status: 'idle' | 'syncing' | 'error';
  error?: string;
} 