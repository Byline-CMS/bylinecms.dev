CREATE TABLE "byline_admin_permissions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"vid" integer DEFAULT 1 NOT NULL,
	"admin_role_id" uuid NOT NULL,
	"ability" varchar(128) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "uq_byline_admin_permissions_role_ability" UNIQUE("admin_role_id","ability")
);
--> statement-breakpoint
CREATE TABLE "byline_admin_role_admin_user" (
	"admin_role_id" uuid NOT NULL,
	"admin_user_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "byline_admin_role_admin_user_admin_role_id_admin_user_id_pk" PRIMARY KEY("admin_role_id","admin_user_id")
);
--> statement-breakpoint
CREATE TABLE "byline_admin_roles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"vid" integer DEFAULT 1 NOT NULL,
	"name" varchar(128) NOT NULL,
	"machine_name" varchar(128) NOT NULL,
	"description" text,
	"order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "byline_admin_roles_machine_name_unique" UNIQUE("machine_name")
);
--> statement-breakpoint
CREATE TABLE "byline_admin_users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"vid" integer DEFAULT 1 NOT NULL,
	"given_name" varchar(100),
	"family_name" varchar(100),
	"username" varchar(64),
	"email" varchar(254) NOT NULL,
	"password" varchar(255) NOT NULL,
	"remember_me" boolean DEFAULT false NOT NULL,
	"last_login" timestamp (6) with time zone,
	"last_login_ip" varchar(45),
	"failed_login_attempts" integer DEFAULT 0 NOT NULL,
	"is_super_admin" boolean DEFAULT false NOT NULL,
	"is_enabled" boolean DEFAULT false NOT NULL,
	"is_email_verified" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "byline_admin_users_username_unique" UNIQUE("username"),
	CONSTRAINT "byline_admin_users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "byline_admin_permissions" ADD CONSTRAINT "byline_admin_permissions_admin_role_id_byline_admin_roles_id_fk" FOREIGN KEY ("admin_role_id") REFERENCES "public"."byline_admin_roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "byline_admin_role_admin_user" ADD CONSTRAINT "byline_admin_role_admin_user_admin_role_id_byline_admin_roles_id_fk" FOREIGN KEY ("admin_role_id") REFERENCES "public"."byline_admin_roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "byline_admin_role_admin_user" ADD CONSTRAINT "byline_admin_role_admin_user_admin_user_id_byline_admin_users_id_fk" FOREIGN KEY ("admin_user_id") REFERENCES "public"."byline_admin_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_byline_admin_permissions_role" ON "byline_admin_permissions" USING btree ("admin_role_id");--> statement-breakpoint
CREATE INDEX "idx_byline_admin_role_admin_user_user" ON "byline_admin_role_admin_user" USING btree ("admin_user_id");--> statement-breakpoint
CREATE INDEX "idx_byline_admin_roles_machine_name" ON "byline_admin_roles" USING btree ("machine_name");--> statement-breakpoint
CREATE INDEX "idx_byline_admin_users_email" ON "byline_admin_users" USING btree ("email");