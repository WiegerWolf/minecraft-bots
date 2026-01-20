#!/usr/bin/env bun
/**
 * Simulation Runner
 *
 * Usage:
 *   bun run sim                    # List available simulations
 *   bun run sim lumberjack         # Run lumberjack simulation
 *
 * Simulations are files matching *.sim.ts in this directory.
 * They run against a real Paper Minecraft server with accurate physics.
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
    'lumberjack': 'run-lumberjack-paper',
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
    console.log('   • lumberjack → run-lumberjack-paper');
    console.log('\nUsage:');
    console.log('   bun run sim <simulation-name>');
    console.log('\nExample:');
    console.log('   bun run sim lumberjack');
    console.log('\nSimulations run against a real Paper server with accurate Minecraft physics.');
    console.log('The server auto-starts if needed. You can also join with a real client.\n');
    return;
  }

  // Check if simulation exists
  const aliases: Record<string, string> = {
    'lumberjack': 'run-lumberjack-paper',
  };
  const actualName = aliases[simName] ?? simName;

  if (!sims.includes(actualName)) {
    console.error(`\n❌ Unknown simulation: ${simName}`);
    console.error(`   Available: ${sims.join(', ')}`);
    console.error(`   Aliases: lumberjack\n`);
    process.exit(1);
  }

  await runSimulation(simName);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
