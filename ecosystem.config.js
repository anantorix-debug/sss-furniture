module.exports = {
  apps: [
    {
      name: 'sss-api',
      script: './dist/src/main.js',
      cwd: './apps/api',
      instances: 2,
      exec_mode: 'cluster',
      env: {
        NODE_ENV: 'production',
        PORT: 4000,
      },
      env_file: './.env.production',
      watch: false,
      max_memory_restart: '500M',
      restart_delay: 4000,
      log_file: '../../../logs/api.log',
      error_file: '../../../logs/api-error.log',
      out_file: '../../../logs/api-out.log',
      listen_timeout: 10000,
      kill_timeout: 5000,
      max_restarts: 10,
      min_uptime: '10s',
      post_update: ['npm install'],
    },
    {
      name: 'sss-web',
      script: 'node_modules/.bin/next',
      args: 'start --port 3000',
      cwd: './apps/web',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        NEXT_PUBLIC_API_URL: 'https://api.sssfurniture.co.in/api',
      },
      log_file: '../../../logs/web.log',
      error_file: '../../../logs/web-error.log',
      out_file: '../../../logs/web-out.log',
      watch: false,
      max_memory_restart: '300M',
      restart_delay: 4000,
    }
  ],

  deploy: {
    production: {
      user: 'sssfurniture',
      host: 'your-vps-ip',
      ref: 'origin/main',
      repo: 'git@github.com:anantorix-debug/sss-furniture.git',
      path: '/home/sssfurniture/app',
      'post-deploy': 'npm install && npm run build && pm2 reload ecosystem.config.js'
    }
  }
};
