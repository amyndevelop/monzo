import { readConfig } from './core.mjs';
import { createGateway } from './server.mjs';
import { DurableStore } from './durable-store.mjs';
import { ChannelEngine } from './channel-engine.mjs';
let config;
let store, engine;
try {
  config = readConfig(process.env);
  if (config.channelsEnabled) {
    store = new DurableStore({ directory: '/state', key: config.storageKey });
    engine = new ChannelEngine(config, { store });
  }
} catch {
  console.error('MONZO Evolution gateway: invalid configuration.');
  process.exit(1);
}
const server = createGateway(config, fetch, engine);
const tasks = new Set(),
  timers = [];
let stopping = false;
function schedule(work, interval) {
  let active = false;
  const run = () => {
    if (active || stopping) return;
    active = true;
    const task = Promise.resolve()
      .then(work)
      .catch(() => {
        console.error('MONZO Evolution gateway: durable channel processing failed.');
        stop(1);
      })
      .finally(() => {
        active = false;
        tasks.delete(task);
      });
    tasks.add(task);
  };
  timers.push(setInterval(run, interval));
  run();
}
if (engine) {
  schedule(() => engine.drainCommands(), 250);
  schedule(() => engine.relay(), 500);
  schedule(() => engine.poll(), 10000);
  schedule(() => store.cleanup(), 3600000);
}
server.listen(config.port, '0.0.0.0', () => console.log('MONZO Evolution gateway started.'));
server.on('error', () => {
  console.error('MONZO Evolution gateway: server error.');
  process.exit(1);
});
function stop(code) {
  if (stopping) return;
  stopping = true;
  for (const timer of timers) clearInterval(timer);
  server.close(async () => {
    await Promise.allSettled([...tasks]);
    store?.close();
    process.exit(code);
  });
  setTimeout(() => process.exit(1), 10000).unref();
}
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => stop(0));
