#!/usr/bin/env node
// One production contract for both gates. No second Python/date parser.
'use strict';
const fs = require('node:fs');
const { validateEventTiming, resolveEventTiming } = require('../public/app.js');
const file = process.argv[2] || 'public/data/events.json';
try {
  const events = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!Array.isArray(events)) throw new Error('events must be an array');
  let failures = 0;
  for (const event of events) {
    const errors = validateEventTiming(event);
    // Also check event-day DST conversions and converted ordering, even if the
    // parser accepted both wall values. Do not depend on host TZ or live now.
    if (!errors.length) {
      const result = resolveEventTiming(event, '2026-01-01T00:00:00Z', 'UTC');
      if (result.status === 'error') errors.push(result.reason);
    }
    if (errors.length) {
      failures++;
      console.error(`event-timing: ${event?.id || '<missing id>'}: ${errors.join('; ')}`);
    }
  }
  if (failures) {
    console.error(`event-timing: FAIL ${failures} event(s)`);
    process.exitCode = 1;
  } else console.log(`event-timing: OK ${events.length} event(s)`);
} catch (error) {
  console.error(`event-timing: FAIL ${file}: ${error.message}`);
  process.exitCode = 1;
}
