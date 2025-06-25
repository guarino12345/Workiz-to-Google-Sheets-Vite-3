import { google } from 'googleapis';

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

export const googleSheetsService = {
  /**
   * Initialize Google Sheets API client
   */
  initializeSheets(config: GoogleSheetsConfig) {
    const auth = new google.auth.GoogleAuth({
      credentials: config.credentials,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    return google.sheets({ version: 'v4', auth });
  },

  /**
   * Create or update spreadsheet with job data
   */
  async syncJobsToSheet(
    config: GoogleSheetsConfig,
    jobs: JobData[],
    sheetName: string = 'Jobs'
  ) {
    const sheets = this.initializeSheets(config);

    try {
      // Prepare headers
      const headers = [
        'UUID',
        'Job Date/Time',
        'Status',
        'Job Source',
        'Job Total Price',
        'First Name',
        'Last Name',
        'Phone',
        'Email',
        'Address',
        'City',
        'State',
        'Postal Code',
        'Job Type',
        'Job Notes',
        'Conversion Value',
        'Sync Date'
      ];

      // Prepare data rows
      const dataRows = jobs.map(job => [
        job.UUID,
        job.JobDateTime,
        job.Status,
        job.JobSource,
        job.JobTotalPrice,
        job.FirstName,
        job.LastName,
        job.Phone,
        job.Email,
        job.Address,
        job.City,
        job.State,
        job.PostalCode,
        job.JobType,
        job.JobNotes,
        job.ConversionValue || 0,
        new Date().toISOString()
      ]);

      // Combine headers and data
      const allData = [headers, ...dataRows];

      // Clear existing data and write new data
      await sheets.spreadsheets.values.clear({
        spreadsheetId: config.spreadsheetId,
        range: `${sheetName}!A:Q`,
      });

      await sheets.spreadsheets.values.update({
        spreadsheetId: config.spreadsheetId,
        range: `${sheetName}!A1`,
        valueInputOption: 'RAW',
        requestBody: {
          values: allData,
        },
      });

      return {
        success: true,
        rowsUpdated: dataRows.length,
        message: `Successfully synced ${dataRows.length} jobs to Google Sheets`
      };
    } catch (error) {
      console.error('Error syncing to Google Sheets:', error);
      throw new Error(`Failed to sync to Google Sheets: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  },

  /**
   * Validate Google Sheets credentials and spreadsheet access
   */
  async validateAccess(config: GoogleSheetsConfig): Promise<boolean> {
    try {
      const sheets = this.initializeSheets(config);
      
      // Try to read the spreadsheet metadata
      await sheets.spreadsheets.get({
        spreadsheetId: config.spreadsheetId,
      });
      
      return true;
    } catch (error) {
      console.error('Google Sheets validation failed:', error);
      return false;
    }
  },

  /**
   * Create a new spreadsheet with the required structure
   */
  async createSpreadsheet(
    credentials: any,
    title: string = 'Workiz Jobs Sync'
  ): Promise<string> {
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    const sheets = google.sheets({ version: 'v4', auth });

    try {
      // Create new spreadsheet
      const spreadsheet = await sheets.spreadsheets.create({
        requestBody: {
          properties: {
            title,
          },
          sheets: [
            {
              properties: {
                title: 'Jobs',
                gridProperties: {
                  rowCount: 1000,
                  columnCount: 17,
                },
              },
            },
          ],
        },
      });

      const spreadsheetId = spreadsheet.data.spreadsheetId!;

      // Set up headers
      const headers = [
        'UUID',
        'Job Date/Time',
        'Status',
        'Job Source',
        'Job Total Price',
        'First Name',
        'Last Name',
        'Phone',
        'Email',
        'Address',
        'City',
        'State',
        'Postal Code',
        'Job Type',
        'Job Notes',
        'Conversion Value',
        'Sync Date'
      ];

      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: 'Jobs!A1:Q1',
        valueInputOption: 'RAW',
        requestBody: {
          values: [headers],
        },
      });

      // Format headers
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          requests: [
            {
              repeatCell: {
                range: {
                  sheetId: 0,
                  startRowIndex: 0,
                  endRowIndex: 1,
                  startColumnIndex: 0,
                  endColumnIndex: 17,
                },
                cell: {
                  userEnteredFormat: {
                    backgroundColor: {
                      red: 0.2,
                      green: 0.6,
                      blue: 0.9,
                    },
                    textFormat: {
                      bold: true,
                      foregroundColor: {
                        red: 1,
                        green: 1,
                        blue: 1,
                      },
                    },
                  },
                },
                fields: 'userEnteredFormat(backgroundColor,textFormat)',
              },
            },
          ],
        },
      });

      return spreadsheetId;
    } catch (error) {
      console.error('Error creating spreadsheet:', error);
      throw new Error(`Failed to create spreadsheet: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
}; 