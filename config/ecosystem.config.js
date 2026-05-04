module.exports = {
  apps: [{
    name:                'abn-consultant',
    script:              './node_modules/next/dist/bin/next',
    args:                'start -p 3002',
    instances:           'max',
    exec_mode:           'cluster',
    watch:               false,
    max_memory_restart:  '400M',
    env:                 { NODE_ENV: 'development', PORT: 3002 },
    env_production:      { NODE_ENV: 'production',  PORT: 3002 },
    error_file:          './logs/error.log',
    out_file:            './logs/out.log',
    log_date_format:     'YYYY-MM-DD HH:mm:ss Z',
    autorestart:         true,
    restart_delay:       3000,
    kill_timeout:        5000,
  }],
};
