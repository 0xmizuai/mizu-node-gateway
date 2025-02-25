# QStash Schedule Manager

A TypeScript command-line tool to list and batch cancel QStash schedules based on filters.

## Features

- List all QStash schedules
- Cancel schedules in batches based on filters:
  - By destination URL
  - By schedule ID pattern
  - By any text in any field
- Schedule cleanup jobs for multiple pools with hourly cron settings
- Dry run mode to preview what would be canceled
- Interactive confirmation before cancellation

## Installation

1. Install dependencies:

```bash
npm install -D typescript ts-node @types/node
npm install @upstash/qstash dotenv
```

2. Copy the example environment file and add your QStash token:

```bash
cp scripts/.env.example scripts/.env
# Edit scripts/.env and add your QStash token
```

## Usage

### List all schedules

```bash
npx ts-node scripts/qstash-schedule-manager.ts list
# or using the npm script
npm run qstash:list
# or using pnpm
pnpm qstash:list
```

### Cancel schedules by filter

Cancel all schedules containing a specific keyword in any field:

```bash
npx ts-node scripts/qstash-schedule-manager.ts cancel --filter="cleanup"
# or using the npm script
npm run qstash:cancel -- --filter="cleanup"
# or using pnpm
pnpm qstash:cancel --filter="cleanup"
```

Cancel schedules by destination URL:

```bash
npx ts-node scripts/qstash-schedule-manager.ts cancel --destination="https://example.com"
# or using pnpm
pnpm qstash:cancel --destination="https://example.com"
```

Cancel schedules by ID pattern:

```bash
npx ts-node scripts/qstash-schedule-manager.ts cancel --id="scd_123"
# or using pnpm
pnpm qstash:cancel --id="scd_123"
```

### Schedule cleanup for multiple pools

Schedule cleanup jobs for a range of pool IDs to run every hour:

```bash
npx ts-node scripts/qstash-schedule-manager.ts schedule-cleanup --start=1 --end=10
# or using the npm script
npm run qstash:schedule-cleanup -- --start=1 --end=10
# or using pnpm
pnpm qstash:schedule-cleanup --start=1 --end=10
```

This will create hourly schedules for cleanup_pool/1 through cleanup_pool/10.

For a single pool:

```bash
pnpm qstash:schedule-cleanup --start=5
```

### Additional options

Dry run (show what would be canceled without actually canceling):

```bash
pnpm qstash:cancel --filter="keyword" --dry-run
```

Skip confirmation prompt:

```bash
pnpm qstash:cancel --filter="keyword" --force
pnpm qstash:schedule-cleanup --start=1 --end=10 --force
```

## Getting your QStash token

1. Go to [Upstash Console](https://console.upstash.com/qstash)
2. Copy your QStash token
3. Add it to your `.env` file or set it as an environment variable

## Requirements

- Node.js v14 or higher
- TypeScript and ts-node
- QStash account with API access
