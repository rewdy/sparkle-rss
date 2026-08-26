# ============================================================================
# Sparkle RSS — THE infra config.
#
# This is the single file a fork edits to point this repo at their own AWS
# account. Every tunable that matters lives here (and in tf/terraform.tfvars,
# which holds our committed examples). Modules keep their own internal
# variables, but you should not need to touch them.
#
# Nothing in here is secret — values are safe to commit. Additive TLS secrets
# (e.g. a Lambda HMAC key) are generated/managed as resources, not inputs.
# ============================================================================

# --- AWS --------------------------------------------------------------------

variable "aws_region" {
  description = "Primary region for all resources (the ACM edge certificate is always created in us-east-1)"
  type        = string
  default     = "us-east-1"
}

# --- Domains ----------------------------------------------------------------
#
# All FQDNs are inputs as full hostnames. The Route53 hosted zone is assumed to
# be the parent of app_domain (e.g. app.example.com -> zone example.com) and
# must already exist in the account.

variable "app_domain" {
  description = "Full hostname serving the app (e.g. app.example.com). Its parent domain must have an existing Route53 hosted zone."
  type        = string
}

variable "deploy_site" {
  description = "Publish the public marketing site. Most forks will want this false and only run the app."
  type        = bool
  default     = false
}

variable "site_domain" {
  description = "Full hostname serving the marketing site (apex or a subdomain of the app zone). Ignored when deploy_site is false."
  type        = string
  default     = null
}

# --- Auth -------------------------------------------------------------------

variable "allow_signups" {
  description = "Allow self-service sign-up. When false (default) the pool is invite-only and admins create users."
  type        = bool
  default     = false
}

variable "enable_local_dev_callbacks" {
  description = "Allow http://localhost:5173 as a Cognito callback so the web UI can run against a deployed API locally"
  type        = bool
  default     = true
}

# --- Names & deploy permissions ---------------------------------------------

variable "name_prefix" {
  description = "Prefix for Cognito pool/client/domain names (must be DNS-safe and account-globally unique)"
  type        = string
  default     = "sparkle"
}

variable "github_repo" {
  description = "GitHub repo allowed to deploy via OIDC (owner/name)"
  type        = string
}

variable "create_oidc_provider" {
  description = "Create the GitHub OIDC identity provider. False if it already exists in the account."
  type        = bool
  default     = true
}

variable "state_bucket_arns" {
  description = "ARNs of the Terraform state bucket(s) the pipeline reads/writes"
  type        = list(string)
}

# --- Build & runtime --------------------------------------------------------

variable "lambda_zip_dir" {
  description = "Directory containing built lambda zips (api.zip, ingest-*.zip)"
  type        = string
  default     = "../dist"
}

variable "content_security_policy" {
  description = "Override the default CSP for the app"
  type        = string
  default     = null
}

variable "alarm_email" {
  description = "Email subscribed to infrastructure CloudWatch alarms (null = no subscription)"
  type        = string
  default     = null
}