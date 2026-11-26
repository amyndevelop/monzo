import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';

// Same guarded sidecar used by the existing SQL migration tests. Never connect to Neon.
export function localPreviewPostgres() {
  const env = { ...process.env };
  for (const name of [
    'DOCKER_HOST',
    'DOCKER_CONTEXT',
    'DOCKER_TLS',
    'DOCKER_TLS_VERIFY',
    'DOCKER_CERT_PATH',
  ])
    delete env[name];
  const docker = (args, input) =>
    execFileSync('docker', ['--host=unix:///var/run/docker.sock', ...args], {
      env,
      input,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  const container = docker(['compose', 'ps', '--quiet', 'test-database']);
  assert.match(container, /^[a-f0-9]{12,64}$/);
  const [info] = JSON.parse(docker(['inspect', container]));
  assert.equal(info.Config.Labels['com.docker.compose.service'], 'test-database');
  assert.ok(info.Config.Env.includes('POSTGRES_DB=monzo_test'));
  assert.deepEqual(info.HostConfig.PortBindings['5432/tcp'], [
    { HostIp: '127.0.0.1', HostPort: '55433' },
  ]);
  const database = 'monzo_preview_baseline_' + randomBytes(6).toString('hex');
  const query = (sql, target = database) => {
    if (target !== database && target !== 'postgres')
      throw new Error('Only the temporary reference database is allowed.');
    return docker(
      [
        'exec',
        '-i',
        container,
        'psql',
        '-X',
        '-v',
        'ON_ERROR_STOP=1',
        '-qAt',
        '-U',
        'monzo',
        '-d',
        target,
      ],
      sql,
    );
  };
  let created = false;
  return {
    database,
    query,
    create() {
      query(`CREATE DATABASE ${database};`, 'postgres');
      created = true;
    },
    close() {
      if (created) {
        query(`DROP DATABASE ${database} WITH (FORCE);`, 'postgres');
        created = false;
      }
    },
  };
}
