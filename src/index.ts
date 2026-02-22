import 'dotenv/config';
import { getDb } from './db/index.js';
import { startServer } from './server.js';

// Initialize database (runs schema.sql, creates tables and indexes)
getDb();

const port = parseInt(process.env.PORT ?? '3000', 10);
startServer(port);
