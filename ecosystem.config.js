/**
 * PM2 Ecosystem Config — Zachi Smart-POS
 * Used by Hostinger VPS to keep the app running 24/7
 *
 * Usage:
 *   pm2 start ecosystem.config.js
 *   pm2 save
 *   pm2 startup
 */
module.exports = {
    apps: [
        {
            name: 'zachi-pos',
            script: 'server.js',
            instances: 1,
            autorestart: true,
            watch: false,
            max_memory_restart: '512M',
            env: {
                NODE_ENV: 'development',
                PORT: 5000
            },
            env_production: {
                NODE_ENV: 'production',
                PORT: 5000
            },
            error_file: './logs/pm2-error.log',
            out_file: './logs/pm2-out.log',
            log_date_format: 'YYYY-MM-DD HH:mm:ss'
        }
    ]
};
