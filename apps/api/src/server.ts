import { openDb } from '@prepkit/db';
import { createApp } from './app.js';
import { describeConfig, loadConfig } from './config.js';

const main = async (): Promise<void> => {
  const config = loadConfig();
  const db = await openDb();
  const { express: app, runner } = createApp(config, db);

  // Boot-time reconciliation: a restart must not leave a kit stuck on "generating" forever.
  const reclaimed = await runner.reclaim();
  if (reclaimed) console.warn(`reclaimed ${reclaimed} interrupted job(s) from a previous run`);

  const server = app.listen(config.port, () => {
    console.log(`prepkit api listening\n  ${describeConfig(config)}\n  store=${db.kind}`);
  });

  const shutdown = (signal: string) => {
    console.log(`${signal} received, shutting down`);
    server.close(() => {
      void db.close().finally(() => process.exit(0));
    });
    // Do not hang forever on a stuck connection.
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
};

main().catch((e) => {
  console.error('failed to start api', e);
  process.exit(1);
});
