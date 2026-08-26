# Sparkle RSS deployment config.
# Forks adjust these. The S3 state backend is configured inline in tf/main.tf
# (edit the bucket/key there for your own account). Everything here is safe to
# commit — no secrets.
app_domain = "app.sparklerss.com"

# Publish the marketing site at the apex + www redirect (our install).
deploy_site = true
site_domain = "sparklerss.com"

# Invite-only by default; our install stays closed.
allow_signups = false

name_prefix = "sparkle"
github_repo = "rewdy/sparkle-rss"

state_bucket_arns = ["arn:aws:s3:::drewmey--devops-tf-state"]