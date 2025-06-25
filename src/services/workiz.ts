// Workiz API service functions
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
}

export interface WorkizResponse {
  flag: boolean;
  data: WorkizJob[];
  has_more: boolean;
  found: number;
  code: number;
}

export const workizService = {
  /**
   * Fetch jobs from Workiz API
   * @param apiToken - Workiz API token
   * @param startDate - Start date in YYYY-MM-DD format (defaults to 14 days ago)
   * @param offset - Offset for pagination (default: 0)
   * @param records - Number of records to fetch (default: 100)
   * @param onlyOpen - Filter for open jobs only (default: false)
   */
  async fetchJobs(
    apiToken: string,
    startDate?: string,
    offset: number = 0,
    records: number = 100,
    onlyOpen: boolean = false
  ): Promise<WorkizResponse> {
    // If no start date provided, default to 14 days ago
    const defaultStartDate = startDate || this.getDefaultStartDate();
    
    const url = `https://api.workiz.com/api/v1/${apiToken}/job/all/?start_date=${defaultStartDate}&offset=${offset}&records=${records}&only_open=${onlyOpen}`;
    
    const response = await fetch(url);
    
    if (!response.ok) {
      throw new Error(`Workiz API error: ${response.status} ${response.statusText}`);
    }
    
    const data = await response.json();
    
    if (!data.flag) {
      throw new Error('Workiz API returned error flag');
    }
    
    return data;
  },

  /**
   * Fetch a specific job by UUID
   * @param apiToken - Workiz API token
   * @param uuid - Job UUID
   */
  async fetchJob(apiToken: string, uuid: string): Promise<WorkizJob> {
    const url = `https://api.workiz.com/api/v1/${apiToken}/job/get/${uuid}/`;
    
    const response = await fetch(url);
    
    if (!response.ok) {
      throw new Error(`Workiz API error: ${response.status} ${response.statusText}`);
    }
    
    const data = await response.json();
    
    if (!data.flag) {
      throw new Error('Workiz API returned error flag');
    }
    
    return data.data;
  },

  /**
   * Get default start date (14 days ago)
   */
  getDefaultStartDate(): string {
    const date = new Date();
    date.setDate(date.getDate() - 14);
    return date.toISOString().split('T')[0]; // YYYY-MM-DD format
  },

  /**
   * Validate API token by making a test request
   * @param apiToken - Workiz API token to validate
   */
  async validateToken(apiToken: string): Promise<boolean> {
    try {
      const startDate = this.getDefaultStartDate();
      const url = `https://api.workiz.com/api/v1/${apiToken}/job/all/?start_date=${startDate}&offset=0&records=1`;
      
      const response = await fetch(url);
      
      if (!response.ok) {
        return false;
      }
      
      const data = await response.json();
      return data.flag === true;
    } catch (error) {
      return false;
    }
  }
}; 