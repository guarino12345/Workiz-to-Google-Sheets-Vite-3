# Workiz to Google Sheets Sync

A service that automatically synchronizes Workiz job data with Google Sheets for Google Ads conversion tracking and reporting.

## Features

- 🔄 Daily sync of Workiz jobs
- 📊 Initial sync of recent jobs (last 14 days)
- 🎯 Source-based job filtering (e.g., Google, GMB)
- 💰 Default conversion value per account
- 👥 Multiple Workiz account support
- 📈 Job status tracking and updates
- 📊 Simple dashboard with reports and logs
- 🔄 Manual sync trigger

## Development Milestones

### 🎯 Milestone 1: Project Setup & Dashboard Foundation

- [ ] Initialize Vite + TypeScript project
- [ ] Set up MongoDB connection
- [ ] Create basic dashboard layout
- [ ] Implement account configuration UI
- [ ] Add environment variable validation

### 🎯 Milestone 2: Account Management

- [ ] Create account management interface
- [ ] Implement Workiz API token validation
- [ ] Add Google Sheets credentials setup
- [ ] Store account configurations in MongoDB
- [ ] Add basic error handling

### 🎯 Milestone 3: Job Data Integration

- [ ] Implement Workiz API client
- [ ] Create job data fetching logic
- [ ] Add job filtering by source
- [ ] Implement job caching in MongoDB
- [ ] Add basic job display in dashboard

### 🎯 Milestone 4: Google Sheets Integration

- [ ] Set up Google Sheets API client
- [ ] Create spreadsheet template
- [ ] Implement data sync to sheets
- [ ] Add sync status tracking
- [ ] Implement manual sync trigger

### 🎯 Milestone 5: Reporting & Monitoring

- [ ] Add sync history tracking
- [ ] Create basic reports
- [ ] Implement error logging
- [ ] Add sync statistics
- [ ] Finalize dashboard UI/UX

## API Integration

### Workiz API Endpoints

- `/job/all/` - Get jobs details

  - Fetches list of jobs sorted by JobDateTime
  - Default time range: last 14 days
  - Supports filtering by start_date
  - Example: `https://api.workiz.com/api/v1/{WORKIZ_API_KEY}/job/all/?start_date=2025-06-01&offset=0&records=100&only_open=true`

- `/job/get/{UUID}/` - Get specific job details
  - Fetches detailed information for a specific job
  - Example: `https://api.workiz.com/api/v1/{WORKIZ_API_KEY}/job/get/JMUC3R/`

## Getting Started

### Prerequisites

- Node.js (version 14 or higher)
- npm (comes with Node.js)
- MongoDB Atlas account
- Workiz API Tokens (multiple accounts supported)
- Google Sheets API credentials

### Installation

1. Clone the repository:

```bash
git clone https://github.com/guarino12345/react-app.git
cd react-app
```

2. Install dependencies:

```bash
npm install
```

3. Create a `.env` file in the root directory with your credentials:

```env
# MongoDB Connection
VITE_MONGODB_URI=your_mongodb_connection_string

# Workiz API Tokens (Multiple accounts supported)
VITE_WORKIZ_API_TOKEN=your_first_workiz_token
VITE_WORKIZ_API_TOKEN_2=your_second_workiz_token

# Google Sheets Configuration
VITE_GOOGLE_SHEETS_CREDENTIALS=your_google_sheets_credentials_json
VITE_GOOGLE_SHEETS_SPREADSHEET_ID=your_spreadsheet_id
```

Note: All environment variables must be prefixed with `VITE_` to be accessible in the React application.

4. Start the development server:

```bash
npm run dev
```

The app will be available at `http://localhost:5173`

## Database Structure

### MongoDB Collections

- `accounts` - Workiz account configurations

  - API keys
  - Default conversion values
  - Source filters
  - Google Sheets IDs

- `syncs` - Sync history and status

  - Last sync time
  - Job counts
  - Error logs
  - Sync status

- `jobs` - Cached Workiz jobs
  - Job details
  - Sync status
  - Conversion values
  - Last update time

## Deployment

### GitHub

The repository is already set up at: https://github.com/guarino12345/react-app

### Vercel

1. Go to [Vercel](https://vercel.com)
2. Sign up or log in with your GitHub account
3. Click "New Project"
4. Import your GitHub repository
5. Add your environment variables (same as .env file)
6. Click "Deploy"

## License

MIT
