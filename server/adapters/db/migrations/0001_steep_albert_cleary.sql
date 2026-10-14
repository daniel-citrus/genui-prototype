DELETE FROM "components";--> statement-breakpoint
ALTER TABLE "components" ADD COLUMN "description" text NOT NULL;--> statement-breakpoint
ALTER TABLE "components" ADD COLUMN "category" text NOT NULL;--> statement-breakpoint
ALTER TABLE "components" ADD COLUMN "children" text NOT NULL;--> statement-breakpoint
ALTER TABLE "components" ADD COLUMN "example_props" jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "components" DROP COLUMN "spec";--> statement-breakpoint
ALTER TABLE "components" ADD CONSTRAINT "components_category_check" CHECK ("components"."category" in ('layout', 'text', 'input', 'display'));--> statement-breakpoint
ALTER TABLE "components" ADD CONSTRAINT "components_children_check" CHECK ("components"."children" in ('none', 'any'));