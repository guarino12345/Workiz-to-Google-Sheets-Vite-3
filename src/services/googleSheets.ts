import { google } from 'googleapis';

interface ConversionData {
  phone: string;
  jobDateTime: string;
  conversionName: string;
  conversionTime: string;
  conversionValue: number;
  conversionCurrency: string;
}

export const appendToGoogleSheet = async (
  spreadsheetId: string,
  data: ConversionData
) => {
  try {
    const auth = new google.auth.GoogleAuth({
      credentials: JSON.parse(import.meta.env.VITE_GOOGLE_SHEETS_CREDENTIALS),
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    const sheets = google.sheets({ version: 'v4', auth });

    const values = [
      [
        data.phone,
        data.jobDateTime,
        data.conversionName,
        data.conversionTime,
        data.conversionValue,
        data.conversionCurrency,
      ],
    ];

    const response = await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: 'Sheet1!A:F', // Adjust range as needed
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values,
      },
    });

    return response.data;
  } catch (error) {
    console.error('Error appending to Google Sheet:', error);
    throw error;
  }
}; 