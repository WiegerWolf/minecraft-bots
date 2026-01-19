#!/usr/bin/env bun
/**
 * Visual Test Runner
 *
 * Usage:
 *   bun run tests/visual/run-visual.ts                    # List available tests
 *   bun run tests/visual/run-visual.ts forest             # Run forest detection test
 *   bun run tests/visual/run-visual.ts forest --auto      # Auto-advance mode
 *   bun run tests/visual/run-visual.ts all --auto         # Run all tests
 */

import { readdirSync } from 'fs';
import { join, dirname } from 'path';
import { spawn } from 'bun';

const VISUAL_DIR = dirname(import.meta.path);

async function listTests(): Promise<string[]> {
  const files = readdirSync(VISUAL_DIR);
  return files
    .filter(f => f.endsWith('.visual.ts') && f !== 'run-visual.ts')
    .map(f => f.replace('.visual.ts', ''));
}

async function runTest(name: string, autoAdvance: boolean): Promise<void> {
  const testFile = join(VISUAL_DIR, `${name}.visual.ts`);

  console.log(`\n🎬 Running visual test: ${name}`);
  console.log(`   File: ${testFile}`);
  console.log(`   Mode: ${autoAdvance ? 'auto-advance' : 'interactive'}\n`);

  const args = ['run', testFile];
  if (autoAdvance) {
    args.push('--auto');
  }

  const proc = spawn({
    cmd: ['bun', ...args],
    stdout: 'inherit',
    stderr: 'inherit',
    stdin: 'inherit',
  });

  await proc.exited;
}

async function main() {
  const args = process.argv.slice(2);
  const testName = args.find(a => !a.startsWith('-'));
  const autoAdvance = args.includes('--auto') || args.includes('-a');

  const tests = await listTests();

  if (!testName) {
    console.log('\n📋 Available Visual Tests:\n');
    for (const test of tests) {
      console.log(`   • ${test}`);
    }
    console.log('\nUsage:');
    console.log('   bun run tests/visual/run-visual.ts <test-name>');
    console.log('   bun run tests/visual/run-visual.ts <test-name> --auto');
    console.log('   bun run tests/visual/run-visual.ts all --auto');
    console.log('\nExample:');
    console.log('   bun run tests/visual/run-visual.ts forest-detection');
    console.log('');
    return;
  }

  if (testName === 'all') {
    console.log(`\n🎬 Running all ${tests.length} visual tests...\n`);
    for (const test of tests) {
      await runTest(test, autoAdvance);
    }
    console.log('\n✨ All visual tests completed!\n');
  } else if (tests.includes(testName)) {
    await runTest(testName, autoAdvance);
  } else {
    console.error(`\n❌ Unknown test: ${testName}`);
    console.error(`   Available tests: ${tests.join(', ')}\n`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
