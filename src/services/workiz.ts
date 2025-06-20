import { ObjectId } from 'mongodb';

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
  Team: {
    id: number;
    Name: string;
  }[];
}

export class WorkizService {
  private baseUrl: string;

  constructor(apiKey: string) {
    this.baseUrl = `http://localhost:3000/api/workiz/${apiKey}`;
  }

  async getJobs(startDate?: string): Promise<WorkizJob[]> {
    try {
      const url = `${this.baseUrl}/jobs?start_date=${startDate || this.getDefaultStartDate()}`;
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error('Failed to fetch jobs');
      }
      const data = await response.json();
      return data.data || [];
    } catch (error) {
      console.error('Error fetching jobs:', error);
      throw error;
    }
  }

  async getJobDetails(uuid: string): Promise<WorkizJob> {
    try {
      const response = await fetch(`${this.baseUrl}/jobs/${uuid}`);
      if (!response.ok) {
        throw new Error('Failed to fetch job details');
      }
      const data = await response.json();
      return data;
    } catch (error) {
      console.error('Error fetching job details:', error);
      throw error;
    }
  }

  private getDefaultStartDate(): string {
    const date = new Date();
    date.setDate(date.getDate() - 14);
    return date.toISOString().split('T')[0];
  }
} 