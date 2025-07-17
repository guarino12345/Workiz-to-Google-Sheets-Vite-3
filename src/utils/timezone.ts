import { formatInTimeZone } from 'date-fns-tz';
import { parseISO } from 'date-fns';

// Timezone options for US-based businesses
export const timezoneOptions = [
  { value: 'America/Los_Angeles', label: 'Pacific Time (PT)' },
  { value: 'America/Denver', label: 'Mountain Time (MT)' },
  { value: 'America/Chicago', label: 'Central Time (CT)' },
  { value: 'America/New_York', label: 'Eastern Time (ET)' },
  { value: 'America/Anchorage', label: 'Alaska Time (AKT)' },
  { value: 'Pacific/Honolulu', label: 'Hawaii Time (HST)' },
];

/**
 * Convert a Workiz timestamp to the account's timezone for display
 * @param workizTimestamp - The timestamp from Workiz API (assumed to be in UTC)
 * @param accountTimezone - The account's preferred timezone
 * @param format - Optional date format (default: 'MMM dd, yyyy h:mm a')
 * @returns Formatted date string in account timezone
 */
export const convertToAccountTimezone = (
  workizTimestamp: string,
  accountTimezone: string = 'America/Los_Angeles',
  format: string = 'MMM dd, yyyy h:mm a'
): string => {
  try {
    if (!workizTimestamp) {
      return 'N/A';
    }

    // Parse the Workiz timestamp (assumed to be in UTC)
    const date = parseISO(workizTimestamp);
    
    // Format the date in the account's timezone
    return formatInTimeZone(date, accountTimezone, format);
  } catch (error) {
    console.error('Error converting timezone:', error);
    return workizTimestamp || 'Invalid Date';
  }
};

/**
 * Get a timezone label from its value
 * @param timezone - The timezone value
 * @returns The human-readable timezone label
 */
export const getTimezoneLabel = (timezone: string): string => {
  const option = timezoneOptions.find(opt => opt.value === timezone);
  return option ? option.label : timezone;
};

/**
 * Convert a date to account timezone for business logic (filtering, etc.)
 * @param date - The date to convert
 * @param accountTimezone - The account's timezone
 * @returns Date object in account timezone
 */
export const getDateInAccountTimezone = (
  date: Date | string,
  accountTimezone: string = 'America/Los_Angeles'
): Date => {
  try {
    const dateObj = typeof date === 'string' ? parseISO(date) : date;
    // For business logic, we return the date as-is since we're storing in Workiz timezone
    // This function can be used for timezone-aware comparisons
    return dateObj;
  } catch (error) {
    console.error('Error getting date in account timezone:', error);
    return new Date();
  }
};

/**
 * Check if a time is within business hours in the account's timezone
 * @param workizTimestamp - The Workiz timestamp
 * @param accountTimezone - The account's timezone
 * @param startHour - Business start hour (default: 8)
 * @param endHour - Business end hour (default: 18)
 * @returns Boolean indicating if time is within business hours
 */
export const isWithinBusinessHours = (
  workizTimestamp: string,
  accountTimezone: string = 'America/Los_Angeles',
  startHour: number = 8,
  endHour: number = 18
): boolean => {
  try {
    const localTime = convertToAccountTimezone(workizTimestamp, accountTimezone, 'HH:mm');
    const hour = parseInt(localTime.split(':')[0]);
    return hour >= startHour && hour < endHour;
  } catch (error) {
    console.error('Error checking business hours:', error);
    return false;
  }
}; 