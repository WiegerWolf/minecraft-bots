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

import { spawn, type Subprocess } from 'bun';
import path from 'path';

const TEST_DIR = import.meta.dir;

interface TestSuite {
  name: string;
  file: string;
}

const TEST_SUITES: TestSuite[] = [
  { name: 'Lumberjack', file: 'lumberjack.test.sim.ts' },
  { name: 'Farmer', file: 'farmer.test.sim.ts' },
  { name: 'Landscaper', file: 'landscaper.test.sim.ts' },
  { name: 'Multi-Bot Coordination', file: 'multi-bot.test.sim.ts' },
];

async function runTestSuite(suite: TestSuite): Promise<{ passed: boolean; output: string }> {
  const testPath = path.join(TEST_DIR, suite.file);

  console.log(`\n${'═'.repeat(70)}`);
  console.log(`RUNNING: ${suite.name} Tests`);
  console.log(`File: ${suite.file}`);
  console.log(`${'═'.repeat(70)}\n`);

  return new Promise((resolve) => {
    const proc = spawn({
      cmd: ['bun', 'run', testPath],
      stdout: 'inherit',
      stderr: 'inherit',
      cwd: path.join(TEST_DIR, '../..'),
    });

    proc.exited.then((exitCode) => {
      resolve({
        passed: exitCode === 0,
        output: '', // Output goes to inherit
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

  const results: Array<{ name: string; passed: boolean }> = [];
  const startTime = Date.now();

  for (const suite of TEST_SUITES) {
    try {
      const result = await runTestSuite(suite);
      results.push({ name: suite.name, passed: result.passed });
    } catch (err) {
      console.error(`Error running ${suite.name}:`, err);
      results.push({ name: suite.name, passed: false });
    }
  }

  const duration = (Date.now() - startTime) / 1000;
  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;

  // Final summary
  console.log('\n' + '█'.repeat(70));
  console.log('█' + ' '.repeat(68) + '█');
  console.log('█' + '     FINAL SUMMARY     '.padStart(45).padEnd(68) + '█');
  console.log('█' + ' '.repeat(68) + '█');
  console.log('█'.repeat(70) + '\n');

  for (const result of results) {
    const status = result.passed ? '✅ PASSED' : '❌ FAILED';
    console.log(`  ${status}  ${result.name}`);
  }

  console.log('\n' + '─'.repeat(70));
  console.log(`  Total: ${results.length} suites | Passed: ${passed} | Failed: ${failed}`);
  console.log(`  Duration: ${duration.toFixed(1)}s`);
  console.log('─'.repeat(70) + '\n');

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Test runner failed:', err);
  process.exit(1);
});
