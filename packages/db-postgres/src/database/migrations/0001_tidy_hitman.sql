CREATE TABLE "byline_admin_passkey_attempts" (
	"token_hash" varchar(64) COLLATE "C" PRIMARY KEY NOT NULL,
	"purpose" varchar(24) NOT NULL,
	"challenge" varchar(43),
	"actor_user_id" uuid,
	"actor_login_id" uuid,
	"actor_generation" integer,
	"action" varchar(8),
	"target_user_id" uuid,
	"credential_record_id" uuid,
	"proof_credential_id" uuid,
	"created_at" timestamp (6) with time zone NOT NULL,
	"expires_at" timestamp (6) with time zone NOT NULL,
	"consumed_at" timestamp (6) with time zone
);
--> statement-breakpoint
CREATE TABLE "byline_admin_passkey_credentials" (
	"id" uuid PRIMARY KEY NOT NULL,
	"admin_user_id" uuid,
	"credential_id" varchar(1366) COLLATE "C" NOT NULL,
	"public_key" text NOT NULL,
	"counter" bigint NOT NULL,
	"transports" jsonb NOT NULL,
	"backup_eligible" boolean NOT NULL,
	"backed_up" boolean NOT NULL,
	"name" varchar(80) NOT NULL,
	"created_at" timestamp (6) with time zone NOT NULL,
	"last_used_at" timestamp (6) with time zone,
	"revoked_at" timestamp (6) with time zone,
	CONSTRAINT "byline_admin_passkey_credentials_credential_id_unique" UNIQUE("credential_id")
);
--> statement-breakpoint
ALTER TABLE "byline_admin_users" ADD COLUMN "webauthn_user_handle" varchar(43) COLLATE "C";--> statement-breakpoint
ALTER TABLE "byline_admin_passkey_credentials" ADD CONSTRAINT "byline_admin_passkey_credentials_admin_user_id_byline_admin_users_id_fk" FOREIGN KEY ("admin_user_id") REFERENCES "public"."byline_admin_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_admin_passkey_attempts_expiry" ON "byline_admin_passkey_attempts" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "idx_admin_passkey_attempts_login" ON "byline_admin_passkey_attempts" USING btree ("actor_login_id");--> statement-breakpoint
CREATE INDEX "idx_admin_passkeys_user" ON "byline_admin_passkey_credentials" USING btree ("admin_user_id");--> statement-breakpoint
ALTER TABLE "byline_admin_users" ADD CONSTRAINT "byline_admin_users_webauthn_user_handle_unique" UNIQUE("webauthn_user_handle");