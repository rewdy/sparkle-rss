ALTER TABLE "subscriptions" ADD COLUMN "fetch_full_articles" boolean;
--> statement-breakpoint
ALTER TABLE "subscriptions" ALTER COLUMN "fetch_full_articles" SET DEFAULT true;
