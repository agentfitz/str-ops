// lib/sessionStore.js — Supabase Postgres-backed session store
// Shared by server.js (local) and Vercel API handlers (production)
import pg from 'pg'
import connectPgSimple from 'connect-pg-simple'
import session from 'express-session'

const PgSession = connectPgSimple(session)

// Singleton pool — created once per process
let _pool = null
function getPool() {
  if (!_pool) {
    _pool = new pg.Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
      max: 3, // small pool for serverless
    })
  }
  return _pool
}

// Singleton store
let _store = null
export function getSessionStore() {
  if (!_store) {
    _store = new PgSession({
      pool:                getPool(),
      tableName:           'sessions',
      createTableIfMissing: true,    // auto-creates the table on first use
    })
  }
  return _store
}
