-- Byline: shared password sign-in admission counters — SCHEMA DDL ONLY.
-- Run as the application database role before deploying sign-in protection.
-- MySQL DDL auto-commits. Table and index are created by one idempotent statement.
-- Existing users, passwords, and sessions are untouched.

CREATE TABLE IF NOT EXISTS `byline_admin_sign_in_rate_limits` (
  `key` varchar(64) NOT NULL,
  `attempts` int NOT NULL,
  `expires_at` datetime(3) NOT NULL,
  CONSTRAINT `byline_admin_sign_in_rate_limits_key` PRIMARY KEY (`key`),
  INDEX `idx_admin_sign_in_rate_limits_expiry` (`expires_at`)
);
