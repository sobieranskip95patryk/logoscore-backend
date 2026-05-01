const path = require('path');
const dotenv = require('dotenv');

const envFile = process.env.ENV_FILE || `env/.env.${process.env.NODE_ENV || 'development'}`;
dotenv.config({ path: path.resolve(process.cwd(), envFile) });

module.exports = {
  migrationFolder: path.resolve(__dirname, 'migrations'),
  databaseUrl: process.env.DATABASE_URL || '',
  schema: 'public',
  direction: 'up'
};
