CREATE INDEX "idx_admin_login_sessions_expiry" ON "byline_admin_login_sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "idx_admin_login_sessions_revoked" ON "byline_admin_login_sessions" USING btree ("revoked_at");--> statement-breakpoint
CREATE INDEX "idx_admin_passkey_attempts_consumed" ON "byline_admin_passkey_attempts" USING btree ("consumed_at");--> statement-breakpoint
CREATE INDEX "idx_admin_refresh_tokens_legacy_expiry" ON "byline_admin_refresh_tokens" USING btree ("sid","expires_at");