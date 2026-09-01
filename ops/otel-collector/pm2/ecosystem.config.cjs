const path = require('path');

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

const collectorPm2Name = 'tu-seguridad-otel-collector';
const collectorMode = String(process.env.OTELCOL_MODE || 'prod').toLowerCase();
const collectorConfigByMode = {
  debug: 'collector.debug.yaml',
  prod: 'collector.prod.yaml',
  test: 'collector.test.yaml',
};
const collectorConfigName = collectorConfigByMode[collectorMode];

if (!collectorConfigName) {
  throw new Error(`Invalid OTELCOL_MODE: ${collectorMode}`);
}

const collectorCwd = path.resolve(__dirname, '..');
const collectorConfigPath = path.resolve(
  __dirname,
  '..',
  'config',
  collectorConfigName,
);

module.exports = {
  apps: [
    {
      name: collectorPm2Name,
      cwd: collectorCwd,
      script: requiredEnv('OTELCOL_BIN'),
      args: [`--config=${collectorConfigPath}`],
      interpreter: 'none',
      autorestart: true,
      max_restarts: 10,
      restart_delay: 3000,
      time: true,
    },
  ],
};
