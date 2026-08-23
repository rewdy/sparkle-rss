# Forks: adjust these defaults, then `terraform init -backend-config=backend.conf`.
# Everything below is safe to commit — no secrets.
root_domain  = "sparklerss.com"
app_hostname = "app"
name_prefix  = "sparkle"
github_repo  = "rewdy/sparkle-rss"

state_bucket_arns = ["arn:aws:s3:::drewmey--devops-tf-state"]
