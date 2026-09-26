/**
 * Cleanup script to delete E2E test calendar events from 29 Sept 2026
 * Preserves "CALENDAR CONNECTION TEST - DO NOT DELETE".
 */
const path = require('path');
const fs = require('fs');

const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf-8');
  let currentKey = null;
  let currentVal = [];
  let inQuotes = false;

  envContent.split('\n').forEach(line => {
    if (!inQuotes) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#') && trimmed.includes('=')) {
        const idx = line.indexOf('=');
        const key = line.substring(0, idx).trim();
        let val = line.substring(idx + 1).trim();

        if (val.startsWith('"') && (!val.endsWith('"') || val.length === 1)) {
          inQuotes = true;
          currentKey = key;
          currentVal = [val.substring(1)];
        } else {
          if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
            val = val.substring(1, val.length - 1);
          }
          process.env[key] = val;
        }
      }
    } else {
      if (line.trim().endsWith('"')) {
        currentVal.push(line.trim().slice(0, -1));
        process.env[currentKey] = currentVal.join('\n');
        inQuotes = false;
        currentKey = null;
        currentVal = [];
      } else {
        currentVal.push(line);
      }
    }
  });
}

const { getCalendarClient, deleteCalendarEvent } = require('../lib/calendar');

async function cleanSept29E2EEvents() {
  const { client, error } = getCalendarClient();
  if (error || !client) {
    console.error('Calendar Client Error:', error);
    return;
  }

  const calendarId = 'kartikeymishra.edu@gmail.com';
  const targetDate = '2026-09-29';

  console.log(`================================================================`);
  console.log(`CLEANING E2E TEST EVENTS FOR ${targetDate} ON ${calendarId}`);
  console.log(`================================================================\n`);

  const eventsRes = await client.events.list({
    calendarId: calendarId,
    timeMin: `${targetDate}T00:00:00+05:30`,
    timeMax: `${targetDate}T23:59:59+05:30`,
    singleEvents: true
  });

  const items = eventsRes.data.items || [];
  console.log(`Found ${items.length} total events on ${targetDate}.`);

  let deletedCount = 0;
  for (const item of items) {
    if (item.summary && item.summary.includes('E2E TEST')) {
      await deleteCalendarEvent(item.id, calendarId);
      deletedCount++;
      console.log(`  ✓ Deleted E2E test event: "${item.summary}" | ID: ${item.id}`);
    } else {
      console.log(`  ℹ️ Preserved non-test event: "${item.summary}" | ID: ${item.id}`);
    }
  }

  console.log(`\nSuccessfully deleted ${deletedCount} E2E test events. Non-test events preserved.\n`);
}

cleanSept29E2EEvents().catch(console.error);
