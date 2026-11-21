module.exports = {
  apps: [
    {
      name: 'tu-seguridad-api',
      script: 'dist/src/main.js',
      instances: 1,
      exec_mode: 'fork', // fork, not cluster: socket.io + in-memory occupancy state
      autorestart: true,
      max_restarts: 10,
      restart_delay: 3000,
      max_memory_restart: '512M',
      time: true,
      env_production: { NODE_ENV: 'production' },
    },
  ],
};
