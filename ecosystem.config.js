// PM2 进程管理配置 - 企鹅求职岛
module.exports = {
  apps: [
    {
      name: 'recruit-dashboard',
      script: 'node_modules/.bin/next',
      args: 'start -p 3001',
      cwd: '/opt/recruitment-dashboard',
      env: {
        NODE_ENV: 'production',
        PORT: 3001,
      },
      instances: 1,
      exec_mode: 'fork',
      max_memory_restart: '512M',
      autorestart: true,
      watch: false,
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      error_file: '/opt/recruitment-dashboard/logs/error.log',
      out_file: '/opt/recruitment-dashboard/logs/out.log',
      merge_logs: true,
    },
  ],
};
