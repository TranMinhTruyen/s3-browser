import type { DbProfile } from '@/pages/sql/stores/dbProfileStore';

// TODO(sprint backend DB): remove this file. Profiles will be loaded from the Go backend, and secrets
// (password) will be encrypted there (utils.KeyManager) instead of living in the frontend store.
export const MOCK_DB_PROFILES: Record<string, DbProfile> = {
  'mock-pg-local': {
    id: 'mock-pg-local',
    name: 'Local PostgreSQL',
    color: '#d0ebff',
    dbType: 'postgresql',
    host: 'localhost',
    port: 5432,
    database: 'postgres',
    username: 'postgres',
    password: '',
    sslMode: 'prefer',
    filePath: '',
    isConnected: false,
  },
  'mock-pg-staging': {
    id: 'mock-pg-staging',
    name: 'Staging PostgreSQL',
    color: '#d3f9d8',
    dbType: 'postgresql',
    host: 'staging.db.example.com',
    port: 5432,
    database: 'app',
    username: 'app_user',
    password: '',
    sslMode: 'require',
    filePath: '',
    isConnected: false,
  },
  'mock-sqlite-local': {
    id: 'mock-sqlite-local',
    name: 'Local SQLite',
    color: '#fff3bf',
    dbType: 'sqlite',
    host: '',
    port: 0,
    database: '',
    username: '',
    password: '',
    sslMode: 'prefer',
    filePath: 'C:/data/sample.db',
    isConnected: false,
  },
};
