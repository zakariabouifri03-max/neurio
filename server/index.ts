#!/usr/bin/env node
/**
 * Standalone Neurio server.
 *
 *   npm run server -- --port 8790 --host 0.0.0.0
 *
 * Flags:
 *   --port <n>            listen port (default 8790)
 *   --host <addr>         bind address (default 0.0.0.0 = whole LAN)
 *   --data-dir <path>     where neurio.sqlite + uploads live
 *   --static <dir>        serve the built renderer from this directory
 *   --no-registration     disable new account creation
 *   --log-level <level>   debug | info | warn | error
 *
 * Environment (all optional, all local):
 *   NEURIO_DATA_DIR, NEURIO_ICE_SERVERS, NEURIO_TURN_USERNAME,
 *   NEURIO_TURN_CREDENTIAL, NEURIO_TRUST_PROXY
 */
import { createApp } from './app';
import { configFromArgv, parseArgs } from './config';
import { logger } from './logger';
import { printStartupBanner } from './banner';

const log = logger('server');

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const { flags } = parseArgs(argv);

  if (flags.get('help') === true || flags.get('h') === true) {
    printHelp();
    return;
  }
  if (flags.get('version') === true) {
    const { SERVER_VERSION } = await import('./config');
    console.log(SERVER_VERSION);
    return;
  }

  const config = configFromArgv(argv);
  const app = await createApp({
    port: config.port,
    host: config.host,
    dataDir: config.dataDir,
    staticDir: config.staticDir,
    registrationOpen: config.registrationOpen,
    logLevel: config.logLevel,
  });

  const started = await app.start();
  printStartupBanner(app, started);

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info(`received ${signal} — shutting down`);
    await app.stop();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('unhandledRejection', (reason) => log.error(`unhandled rejection: ${String(reason)}`));
  process.on('uncaughtException', (error) => log.error(`uncaught exception: ${error.stack ?? error.message}`));
}

function printHelp(): void {
  console.log(`Neurio server

Usage: npm run server -- [options]

Options:
  --port <n>            listen port (default 8790)
  --host <addr>         bind address (default 0.0.0.0 — reachable from your LAN)
  --data-dir <path>     database + uploads directory
  --static <dir>        serve the built renderer from this directory
  --no-registration     disable account creation
  --log-level <level>   debug | info | warn | error
  --help                show this message
`);
}

main().catch((error) => {
  log.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
});
