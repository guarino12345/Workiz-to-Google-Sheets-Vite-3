import { ObjectId } from 'mongodb';

export interface Account {
  _id?: ObjectId;
  workizApiToken: string;
  googleSheetsId: string;
  sourceFilter: string;
  defaultConversionValue: number;
  createdAt: Date;
  updatedAt: Date;
}

const API_URL = 'http://localhost:3000/api';

export const mongodbService = {
  async getAccounts(): Promise<Account[]> {
    const response = await fetch(`${API_URL}/accounts`);
    if (!response.ok) {
      throw new Error('Failed to fetch accounts');
    }
    return response.json();
  },

  async saveAccount(account: Omit<Account, '_id' | 'createdAt' | 'updatedAt'>): Promise<Account> {
    const response = await fetch(`${API_URL}/accounts`, {
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
    const response = await fetch(`${API_URL}/accounts/${id}`, {
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
    const response = await fetch(`${API_URL}/accounts/${id}`, {
      method: 'DELETE',
    });
    if (!response.ok) {
      throw new Error('Failed to delete account');
    }
  },
}; 