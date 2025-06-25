import { ObjectId } from 'mongodb';
import { buildApiUrl } from '../utils/api';

export interface Account {
  _id?: ObjectId;
  id?: string;
  name: string;
  workizApiToken: string;
  googleSheetsId: string;
  sourceFilter: string[];
  defaultConversionValue: number;
  syncEnabled: boolean;
  syncFrequency: 'daily' | 'weekly' | 'monthly' | 'custom';
  syncTime: string;
  lastSyncDate?: Date;
  nextSyncDate?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export const mongodbService = {
  async getAccounts(): Promise<Account[]> {
    const response = await fetch(buildApiUrl('/api/accounts'));
    if (!response.ok) {
      throw new Error('Failed to fetch accounts');
    }
    return response.json();
  },

  async saveAccount(account: Omit<Account, '_id' | 'id' | 'createdAt' | 'updatedAt'>): Promise<Account> {
    const response = await fetch(buildApiUrl('/api/accounts'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(account),
    });
    if (!response.ok) {
      throw new Error('Failed to save account');
    }
    return response.json();
  },

  async updateAccount(id: string, account: Partial<Account>): Promise<Account> {
    const response = await fetch(buildApiUrl(`/api/accounts/${id}`), {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(account),
    });
    if (!response.ok) {
      throw new Error('Failed to update account');
    }
    return response.json();
  },

  async deleteAccount(id: string): Promise<void> {
    const response = await fetch(buildApiUrl(`/api/accounts/${id}`), {
      method: 'DELETE',
    });
    if (!response.ok) {
      throw new Error('Failed to delete account');
    }
  },

  async getJobs(): Promise<any[]> {
    const response = await fetch(buildApiUrl('/api/jobs'));
    if (!response.ok) {
      throw new Error('Failed to fetch jobs');
    }
    return response.json();
  },

  async syncJobs(accountId: string): Promise<any> {
    const response = await fetch(buildApiUrl(`/api/sync-jobs/${accountId}`), {
      method: 'POST',
    });
    if (!response.ok) {
      throw new Error('Failed to sync jobs');
    }
    return response.json();
  },

  async getSyncHistory(accountId: string): Promise<any[]> {
    const response = await fetch(buildApiUrl(`/api/sync-history/${accountId}`));
    if (!response.ok) {
      throw new Error('Failed to fetch sync history');
    }
    return response.json();
  },

  async createSyncHistory(syncData: any): Promise<any> {
    const response = await fetch(buildApiUrl('/api/sync-history'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(syncData),
    });
    if (!response.ok) {
      throw new Error('Failed to create sync history');
    }
    return response.json();
  }
}; 