#!/usr/bin/env bun
/**
 * Simulation Runner
 *
 * Usage:
 *   bun run sim                    # List available simulations
 *   bun run sim lumberjack         # Run lumberjack simulation
 *   bun run sim example-lumberjack # Run example simulation
 *
 * Simulations are files matching *.sim.ts in this directory.
 */

import { readdirSync } from 'fs';
import { join, dirname } from 'path';
import { spawn } from 'bun';

const SIM_DIR = dirname(import.meta.path);

async function listSimulations(): Promise<string[]> {
  const files = readdirSync(SIM_DIR);
  return files
    .filter(f => f.endsWith('.sim.ts'))
    .map(f => f.replace('.sim.ts', ''));
}

async function runSimulation(name: string): Promise<void> {
  // Handle aliases
  const aliases: Record<string, string> = {
    'lumberjack': 'run-lumberjack',
    'example': 'example-lumberjack',
  };

  const actualName = aliases[name] ?? name;
  const simFile = join(SIM_DIR, `${actualName}.sim.ts`);

  console.log(`\n🎮 Running simulation: ${actualName}`);
  console.log(`   File: ${simFile}\n`);

  const proc = spawn({
    cmd: ['bun', 'run', simFile],
    stdout: 'inherit',
    stderr: 'inherit',
    stdin: 'inherit',
  });

  await proc.exited;
}

async function main() {
  const args = process.argv.slice(2);
  const simName = args.find(a => !a.startsWith('-'));

  const sims = await listSimulations();

  if (!simName) {
    console.log('\n🎮 Available Simulations:\n');
    for (const sim of sims) {
      console.log(`   • ${sim}`);
    }
    console.log('\nAliases:');
    console.log('   • lumberjack  → run-lumberjack');
    console.log('   • example     → example-lumberjack');
    console.log('\nUsage:');
    console.log('   bun run sim <simulation-name>');
    console.log('\nExample:');
    console.log('   bun run sim lumberjack');
    console.log('\nSimulations start a real flying-squid server + prismarine-viewer.');
    console.log('Your bot runs with full physics against a custom world you define.\n');
    return;
  }

  // Check if simulation exists
  const actualName = simName === 'lumberjack' ? 'run-lumberjack' :
                     simName === 'example' ? 'example-lumberjack' : simName;

  if (!sims.includes(actualName)) {
    console.error(`\n❌ Unknown simulation: ${simName}`);
    console.error(`   Available: ${sims.join(', ')}`);
    console.error(`   Aliases: lumberjack, example\n`);
    process.exit(1);
  }

  await runSimulation(simName);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
