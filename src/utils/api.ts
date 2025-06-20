// API URL configuration for different environments
const getApiBaseUrl = () => {
  // Check if we're in development (localhost) or production (Vercel)
  if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
    return 'http://localhost:3000';
  }
  // In production (Vercel), use relative URLs
  return '';
};

export const API_BASE_URL = getApiBaseUrl();

// Helper function to build API URLs
export const buildApiUrl = (endpoint: string) => {
  return `${API_BASE_URL}${endpoint}`;
}; 