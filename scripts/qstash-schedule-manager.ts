#!/usr/bin/env ts-node

/**
 * QStash Schedule Manager
 *
 * This script lists all QStash schedules and allows you to cancel them in batches based on filters.
 * It also allows scheduling cleanup jobs for multiple pools.
 *
 * Usage:
 *   - List all schedules: ts-node scripts/qstash-schedule-manager.ts list
 *   - Cancel schedules by filter: ts-node scripts/qstash-schedule-manager.ts cancel --filter="keyword"
 *   - Cancel schedules by destination: ts-node scripts/qstash-schedule-manager.ts cancel --destination="https://example.com"
 *   - Cancel schedules by ID pattern: ts-node scripts/qstash-schedule-manager.ts cancel --id="scd_123"
 *   - Dry run (show what would be canceled without actually canceling): ts-node scripts/qstash-schedule-manager.ts cancel --filter="keyword" --dry-run
 *   - Schedule cleanup for pools: ts-node scripts/qstash-schedule-manager.ts schedule-cleanup --start=1 --end=10
 *
 * Requirements:
 *   - Node.js v14+
 *   - TypeScript and ts-node
 *   - @upstash/qstash package
 *   - QSTASH_TOKEN environment variable or .env file
 */

import { Client } from '@upstash/qstash';
import * as readline from 'readline';
import * as dotenv from 'dotenv';

// Define the Schedule interface based on QStash API response
interface Schedule {
  scheduleId: string;
  createdAt: number;
  cron: string;
  destination: string;
  method: string;
  header?: Record<string, string[]>;
  body?: string;
  retries?: number;
  delay?: number;
  callback?: string;
  [key: string]: any;
}

// Load environment variables
dotenv.config();

// Get QStash token from environment variables
const QSTASH_TOKEN = process.env.QSTASH_TOKEN;

if (!QSTASH_TOKEN) {
  console.error('Error: QSTASH_TOKEN environment variable is required');
  console.error('Please set it in your environment or create a .env file');
  process.exit(1);
}

// Initialize QStash client
const qstashClient = new Client({
  token: QSTASH_TOKEN,
});

// Parse command line arguments
const args = process.argv.slice(2);
const command = args[0];

// Define types for options
interface ScheduleFilterOptions {
  destination?: string;
  id?: string;
  filter?: string;
  'dry-run'?: boolean;
  force?: boolean;
  start?: string;
  end?: string;
  [key: string]: string | boolean | undefined;
}

// Helper function to parse command line options
function parseOptions(args: string[]): ScheduleFilterOptions {
  const options: ScheduleFilterOptions = {};
  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      const [key, value] = arg.slice(2).split('=');
      options[key] = value || true;
    }
  }
  return options;
}

// Function to list all schedules
async function listSchedules(): Promise<Schedule[]> {
  try {
    console.log('Fetching all QStash schedules...');

    // Get all schedules using the QStash API
    const schedules = (await qstashClient.schedules.list()) as Schedule[];

    if (schedules.length === 0) {
      console.log('No schedules found.');
      return [];
    }

    console.log(`Found ${schedules.length} schedules:`);
    console.log('-----------------------------------');

    // Display schedules in a table format
    schedules.forEach((schedule, index) => {
      console.log(`[${index + 1}] ID: ${schedule.scheduleId}`);
      console.log(`    Created: ${new Date(schedule.createdAt).toISOString()}`);
      console.log(`    Cron: ${schedule.cron}`);
      console.log(`    Destination: ${schedule.destination}`);
      console.log(`    Method: ${schedule.method}`);
      console.log('-----------------------------------');
    });

    return schedules;
  } catch (error) {
    console.error('Error listing schedules:', (error as Error).message);
    return [];
  }
}

// Function to filter schedules based on criteria
function filterSchedules(schedules: Schedule[], options: ScheduleFilterOptions): Schedule[] {
  let filtered = [...schedules];

  // Filter by destination URL
  if (options.destination) {
    filtered = filtered.filter(
      schedule =>
        schedule.destination && schedule.destination.includes(options.destination as string),
    );
  }

  // Filter by schedule ID pattern
  if (options.id) {
    filtered = filtered.filter(
      schedule => schedule.scheduleId && schedule.scheduleId.includes(options.id as string),
    );
  }

  // Filter by any text in any field
  if (options.filter) {
    filtered = filtered.filter(schedule =>
      JSON.stringify(schedule)
        .toLowerCase()
        .includes((options.filter as string).toLowerCase()),
    );
  }

  return filtered;
}

// Function to cancel schedules
async function cancelSchedules(options: ScheduleFilterOptions): Promise<void> {
  try {
    // First, get all schedules
    const allSchedules = await listSchedules();

    if (allSchedules.length === 0) {
      return;
    }

    // Filter schedules based on options
    const schedulesToCancel = filterSchedules(allSchedules, options);

    if (schedulesToCancel.length === 0) {
      console.log('No schedules match the specified filters.');
      return;
    }

    console.log(`\nFound ${schedulesToCancel.length} schedules to cancel:`);
    console.log('-----------------------------------');

    // Display schedules that will be canceled
    schedulesToCancel.forEach((schedule, index) => {
      console.log(`[${index + 1}] ID: ${schedule.scheduleId}`);
      console.log(`    Destination: ${schedule.destination}`);
      console.log(`    Cron: ${schedule.cron}`);
      console.log('-----------------------------------');
    });

    // If dry run, stop here
    if (options['dry-run']) {
      console.log('\nDRY RUN: No schedules were actually canceled.');
      return;
    }

    // Confirm cancellation
    if (!options.force) {
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });

      await new Promise<void>(resolve => {
        rl.question(
          `\nAre you sure you want to cancel these ${schedulesToCancel.length} schedules? (y/N) `,
          answer => {
            rl.close();
            if (answer.toLowerCase() !== 'y') {
              console.log('Operation canceled.');
              process.exit(0);
            }
            resolve();
          },
        );
      });
    }

    // Cancel each schedule
    console.log('\nCanceling schedules...');
    let successCount = 0;
    let failCount = 0;

    for (const schedule of schedulesToCancel) {
      try {
        await qstashClient.schedules.delete(schedule.scheduleId);
        console.log(`✓ Canceled schedule: ${schedule.scheduleId}`);
        successCount++;
      } catch (error) {
        console.error(
          `✗ Failed to cancel schedule ${schedule.scheduleId}: ${(error as Error).message}`,
        );
        failCount++;
      }
    }

    console.log(`\nCancellation complete: ${successCount} succeeded, ${failCount} failed`);
  } catch (error) {
    console.error('Error canceling schedules:', (error as Error).message);
  }
}

// Function to schedule cleanup for multiple pools
async function scheduleCleanup(options: ScheduleFilterOptions): Promise<void> {
  try {
    // Parse start and end pool IDs
    const startId = parseInt(options.start as string) || 1;
    const endId = parseInt(options.end as string) || startId;

    if (isNaN(startId) || isNaN(endId) || startId < 1 || endId < startId) {
      console.error('Error: Invalid start or end pool ID');
      console.error(
        'Usage: ts-node scripts/qstash-schedule-manager.ts schedule-cleanup --start=1 --end=10',
      );
      return;
    }

    console.log(`Scheduling cleanup for pools ${startId} to ${endId} to run every hour...`);

    // Confirm scheduling
    if (!options.force) {
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });

      await new Promise<void>(resolve => {
        rl.question(
          `\nAre you sure you want to schedule cleanup for pools ${startId} to ${endId}? (y/N) `,
          answer => {
            rl.close();
            if (answer.toLowerCase() !== 'y') {
              console.log('Operation canceled.');
              process.exit(0);
            }
            resolve();
          },
        );
      });
    }

    // Schedule cleanup for each pool
    let successCount = 0;
    let failCount = 0;

    // Get API key from environment if available
    const apiKey = process.env.INTERNAL_SERVICE_API_KEY || '';

    for (let poolId = startId; poolId <= endId; poolId++) {
      try {
        const destination = `https://node.mizuai.io/cleanup_pool/${poolId}`;

        // Create schedule with hourly cron
        const { scheduleId } = await qstashClient.schedules.create({
          destination,
          cron: '0 * * * *', // Run every hour at minute 0
          headers: {
            'X-API-KEY': apiKey,
          },
          retries: 3, // Retry up to 3 times if the request fails
        });

        console.log(`✓ Created schedule for pool ${poolId}: ${scheduleId}`);
        console.log(`  Destination: ${destination}`);
        console.log(`  Cron: 0 * * * * (every hour)`);
        console.log('-----------------------------------');

        successCount++;
      } catch (error) {
        console.error(
          `✗ Failed to schedule cleanup for pool ${poolId}: ${(error as Error).message}`,
        );
        failCount++;
      }
    }

    console.log(`\nScheduling complete: ${successCount} succeeded, ${failCount} failed`);
  } catch (error) {
    console.error('Error scheduling cleanup:', (error as Error).message);
  }
}

// Main function
async function main(): Promise<void> {
  const options = parseOptions(args);

  if (command === 'list') {
    await listSchedules();
  } else if (command === 'cancel') {
    await cancelSchedules(options);
  } else if (command === 'schedule-cleanup') {
    await scheduleCleanup(options);
  } else {
    console.log(`
QStash Schedule Manager

Usage:
  ts-node scripts/qstash-schedule-manager.ts <command> [options]

Commands:
  list                        List all schedules
  cancel                      Cancel schedules based on filters
  schedule-cleanup            Schedule cleanup for multiple pools

Options for 'cancel':
  --filter=<text>             Filter schedules containing this text in any field
  --destination=<url>         Filter schedules by destination URL
  --id=<pattern>              Filter schedules by ID pattern
  --dry-run                   Show what would be canceled without actually canceling
  --force                     Skip confirmation prompt

Options for 'schedule-cleanup':
  --start=<number>            Starting pool ID (default: 1)
  --end=<number>              Ending pool ID (default: same as start)
  --force                     Skip confirmation prompt

Examples:
  ts-node scripts/qstash-schedule-manager.ts list
  ts-node scripts/qstash-schedule-manager.ts cancel --filter="cleanup"
  ts-node scripts/qstash-schedule-manager.ts cancel --destination="https://example.com" --dry-run
  ts-node scripts/qstash-schedule-manager.ts cancel --id="scd_123" --force
  ts-node scripts/qstash-schedule-manager.ts schedule-cleanup --start=1 --end=10
    `);
  }
}

main().catch(console.error);
