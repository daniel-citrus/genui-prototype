CREATE TABLE "custom_component_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"component_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"description" text NOT NULL,
	"category" text NOT NULL,
	"children" text NOT NULL,
	"props_schema" jsonb NOT NULL,
	"example_props" jsonb NOT NULL,
	"template" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "custom_component_versions_component_version_unique" UNIQUE("component_id","version"),
	CONSTRAINT "custom_component_versions_category_check" CHECK ("custom_component_versions"."category" in ('layout', 'text', 'input', 'display')),
	CONSTRAINT "custom_component_versions_children_check" CHECK ("custom_component_versions"."children" in ('none', 'any'))
);
--> statement-breakpoint
CREATE TABLE "custom_components" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"current_version" integer NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "custom_component_versions" ADD CONSTRAINT "custom_component_versions_component_id_custom_components_id_fk" FOREIGN KEY ("component_id") REFERENCES "public"."custom_components"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "custom_components_name_lower_unique" ON "custom_components" USING btree (lower("name"));