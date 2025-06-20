export interface Account {
  id: string;
  name: string;
  workizApiToken: string;
  googleSheetId?: string;
  sourceFilter?: string[];
  defaultConversionValue: number;
} 