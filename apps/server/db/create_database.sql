-- Create database once. Run against the default `postgres` database.
SELECT 'CREATE DATABASE holdem_lite OWNER postgres'
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'holdem_lite')\gexec
