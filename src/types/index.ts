// Account configuration types
export interface Account {
  id?: string;
  _id?: string;
  name: string;
  workizApiToken: string;
  googleSheetsId: string;
  whatconvertsApiKey?: string;
  whatconvertsApiSecret?: string;
  sourceFilter: string[];
  defaultConversionValue: number;
  timezone: string; // User's preferred timezone for display
  // New scheduling fields
  syncEnabled: boolean;
  syncFrequency: 'daily' | 'weekly' | 'monthly' | 'custom';
  syncTime: string; // HH:MM format
  lastSyncDate?: Date;
  nextSyncDate?: Date;
  createdAt?: Date;
  updatedAt?: Date;
}

// Workiz Job types (matching the API response)
export interface WorkizJob {
  UUID: string;
  LocationId: number;
  LocationKey: string;
  SerialId: number;
  JobDateTime: string;
  JobEndDateTime: string;
  CreatedDate: string;
  JobTotalPrice: number;
  JobAmountDue: number;
  SubTotal: number;
  item_cost: number;
  tech_cost: number;
  ClientId: number;
  Status: string;
  SubStatus: string;
  PaymentDueDate: string;
  Phone: string;
  SecondPhone: string;
  PhoneExt: string;
  SecondPhoneExt: string;
  Email: string;
  Comments: string;
  FirstName: string;
  LastName: string;
  LineItems: any[];
  Company: string;
  Address: string;
  City: string;
  State: string;
  PostalCode: string;
  Country: string;
  Latitude: number;
  Longitude: number;
  Unit: string;
  JobType: string;
  JobNotes: string;
  JobSource: string;
  Tags: string[];
  CreatedBy: string;
  LastStatusUpdate: string;
  Team: Array<{
    id: number;
    Name: string;
  }>;
  accountId?: string; // Added for database storage
  gclid?: string; // Added from WhatConverts
  whatconvertsDateCreated?: string; // Added from WhatConverts
}

// Job types (simplified for UI)
export interface Job {
  UUID: string;
  JobDateTime: string;
  Status: string;
  JobSource: string;
  JobTotalPrice: number;
  accountId?: string;
  FirstName?: string;
  LastName?: string;
  Phone?: string;
  Email?: string;
  Address?: string;
  City?: string;
  State?: string;
  PostalCode?: string;
  JobType?: string;
  JobNotes?: string;
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
    // Jobs sync details
    jobsFromWorkiz?: number;
    existingJobsFound?: number;
    finalJobCount?: number;
    jobsUpdated?: number;
    jobsDeleted?: number;
    failedUpdates?: number;
    
    // Google Sheets sync details
    totalJobs?: number;
    filteredJobs?: number;
    updatedRows?: number;
    sourceFilter?: string[];
    sampleJobSources?: string[];
    
    // Enhanced details
    syncMethod?: 'manual' | 'cron';
    whatconvertsEnabled?: boolean;
    whatconvertsStats?: {
      jobsWithGclid: number;
      jobsWithoutGclid: number;
      totalJobsWithGclid: number;
    };
    errorDetails?: string;
    jobStatusBreakdown?: {
      submitted: number;
      pending: number;
      completed: number;
      cancelled: number;
    };
            conversionValueLogic?: {
          defaultValue: number;
          jobsWithJobTotalPrice: number;
          jobsWithCancelledStatus: number;
          totalConversionValue: number;
        };
        dateFieldStatistics?: {
          jobsWithCreatedDate: number;
          jobsWithLastStatusUpdate: number;
          jobsWithBothDates: number;
          jobsWithFallbackDates: number;
          accountTimezone: string;
        };
        dateFilter?: {
          enabled: boolean;
          daysBack: number;
          cutoffDate: string;
        };
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

// Google Sheets types
export interface GoogleSheetsConfig {
  credentials: any;
  spreadsheetId: string;
}

export interface JobData {
  UUID: string;
  JobDateTime: string;
  Status: string;
  JobSource: string;
  JobTotalPrice: number;
  FirstName: string;
  LastName: string;
  Phone: string;
  Email: string;
  Address: string;
  City: string;
  State: string;
  PostalCode: string;
  JobType: string;
  JobNotes: string;
  ConversionValue?: number;
} 