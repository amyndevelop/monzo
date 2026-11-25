import { readConfig } from './core.mjs';
import { createGateway } from './server.mjs';
let config;
try {
  config = readConfig(process.env);
} catch {
  console.error('MONZO Evolution gateway: invalid configuration.');
  process.exit(1);
}
const server = createGateway(config);
server.listen(config.port, '0.0.0.0', () => console.log('MONZO Evolution gateway started.'));
server.on('error', () => {
  console.error('MONZO Evolution gateway: server error.');
  process.exit(1);
});
for (const signal of ['SIGTERM', 'SIGINT'])
  process.on(signal, () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 10000).unref();
  });
