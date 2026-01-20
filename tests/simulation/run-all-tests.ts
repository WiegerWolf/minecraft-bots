#!/usr/bin/env bun
/**
 * Run All Simulation Tests
 *
 * Executes all simulation test suites in sequence.
 * Each test suite manages its own server/bot lifecycle.
 *
 * Usage:
 *   bun run tests/simulation/run-all-tests.ts
 *   bun run sim:test
 */

import { spawn } from 'bun';
import path from 'path';

const TEST_DIR = import.meta.dir;

interface TestSuite {
  name: string;
  file: string;
}

interface FailedAssertion {
  test: string;
  assertion: string;
  error?: string;
}

interface SuiteResult {
  name: string;
  file: string;
  passed: boolean;
  failures: FailedAssertion[];
  output: string;
}

const TEST_SUITES: TestSuite[] = [
  { name: 'Lumberjack', file: 'lumberjack.test.sim.ts' },
  { name: 'Farmer', file: 'farmer.test.sim.ts' },
  { name: 'Landscaper', file: 'landscaper.test.sim.ts' },
  { name: 'Multi-Bot Coordination', file: 'multi-bot.test.sim.ts' },
];

/**
 * Parse test output to extract failed assertions.
 */
function parseFailures(output: string): FailedAssertion[] {
  const failures: FailedAssertion[] = [];
  const lines = output.split('\n');

  let currentTest = '';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Detect test name from "TEST: Test Name" lines
    const testMatch = line.match(/^TEST:\s*(.+)$/);
    if (testMatch) {
      currentTest = testMatch[1];
      continue;
    }

    // Detect failed assertions (lines starting with ✗)
    const failMatch = line.match(/^\s*[✗✖]\s*(.+)$/);
    if (failMatch) {
      const assertion = failMatch[1];
      // Check if next line has error details (starts with └─)
      let error: string | undefined;
      if (i + 1 < lines.length) {
        const nextLine = lines[i + 1];
        const errorMatch = nextLine.match(/^\s*└─\s*(.+)$/);
        if (errorMatch) {
          error = errorMatch[1];
        }
      }
      failures.push({ test: currentTest, assertion, error });
    }
  }

  return failures;
}

async function runTestSuite(suite: TestSuite): Promise<SuiteResult> {
  const testPath = path.join(TEST_DIR, suite.file);

  console.log(`\n${'═'.repeat(70)}`);
  console.log(`RUNNING: ${suite.name} Tests`);
  console.log(`File: ${suite.file}`);
  console.log(`${'═'.repeat(70)}\n`);

  return new Promise((resolve) => {
    const chunks: Buffer[] = [];

    const proc = spawn({
      cmd: ['bun', 'run', testPath],
      stdout: 'pipe',
      stderr: 'pipe',
      cwd: path.join(TEST_DIR, '../..'),
    });

    // Stream output to console while also capturing it
    const readStream = async (stream: ReadableStream<Uint8Array>, isStderr = false) => {
      const reader = stream.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(Buffer.from(value));
        // Write to console in real-time
        process.stdout.write(value);
      }
    };

    Promise.all([
      readStream(proc.stdout),
      readStream(proc.stderr, true),
    ]).then(() => {
      proc.exited.then((exitCode) => {
        const output = Buffer.concat(chunks).toString('utf-8');
        const failures = parseFailures(output);

        resolve({
          name: suite.name,
          file: suite.file,
          passed: exitCode === 0,
          failures,
          output,
        });
      });
    });
  });
}

async function main() {
  console.log('\n' + '█'.repeat(70));
  console.log('█' + ' '.repeat(68) + '█');
  console.log('█' + '     MINECRAFT BOT SIMULATION TEST SUITE     '.padStart(45).padEnd(68) + '█');
  console.log('█' + ' '.repeat(68) + '█');
  console.log('█'.repeat(70) + '\n');

  const results: SuiteResult[] = [];
  const startTime = Date.now();

  for (const suite of TEST_SUITES) {
    try {
      const result = await runTestSuite(suite);
      results.push(result);
    } catch (err) {
      console.error(`Error running ${suite.name}:`, err);
      results.push({
        name: suite.name,
        file: suite.file,
        passed: false,
        failures: [{ test: 'Suite Execution', assertion: 'Suite should run', error: String(err) }],
        output: '',
      });
    }
  }

  const duration = (Date.now() - startTime) / 1000;
  const passedCount = results.filter(r => r.passed).length;
  const failedCount = results.filter(r => !r.passed).length;

  // Final summary
  console.log('\n' + '█'.repeat(70));
  console.log('█' + ' '.repeat(68) + '█');
  console.log('█' + '     FINAL SUMMARY     '.padStart(45).padEnd(68) + '█');
  console.log('█' + ' '.repeat(68) + '█');
  console.log('█'.repeat(70) + '\n');

  for (const result of results) {
    const status = result.passed ? '✅ PASSED' : '❌ FAILED';
    console.log(`  ${status}  ${result.name}`);

    // Show failures for failed suites
    if (!result.passed && result.failures.length > 0) {
      for (const failure of result.failures) {
        const testInfo = failure.test ? ` [${failure.test}]` : '';
        console.log(`           ✗ ${failure.assertion}${testInfo}`);
        if (failure.error) {
          console.log(`             └─ ${failure.error}`);
        }
      }
    }
  }

  console.log('\n' + '─'.repeat(70));
  console.log(`  Total: ${results.length} suites | Passed: ${passedCount} | Failed: ${failedCount}`);
  console.log(`  Duration: ${duration.toFixed(1)}s`);
  console.log('─'.repeat(70) + '\n');

  process.exit(failedCount > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Test runner failed:', err);
  process.exit(1);
});
