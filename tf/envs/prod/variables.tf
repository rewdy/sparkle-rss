variable "aws_region" {
  description = "Primary region for all resources (edge cert is always created in us-east-1)"
  type        = string
  default     = "us-east-1"
}

variable "root_domain" {
  description = "Registered apex domain with an existing Route53 hosted zone"
  type        = string
  default     = "sparklerss.com"
}

variable "app_hostname" {
  description = "Hostname under root_domain serving the app"
  type        = string
  default     = "app"
}

variable "name_prefix" {
  description = "Prefix for Cognito pool/client/domain names"
  type        = string
  default     = "sparkle"
}

variable "github_repo" {
  description = "GitHub repo allowed to deploy via OIDC (owner/name)"
  type        = string
  default     = "rewdy/sparkle-rss"
}

variable "create_oidc_provider" {
  type    = bool
  default = true
}

variable "state_bucket_arns" {
  description = "ARNs of the Terraform state bucket(s) the pipeline reads/writes"
  type        = list(string)
}

variable "enable_local_dev_callbacks" {
  description = "Allow http://localhost:5173 as a Cognito callback for local development"
  type        = bool
  default     = true
}

variable "lambda_zip_dir" {
  description = "Directory containing built lambda zips (api.zip, ingest-*.zip)"
  type        = string
  default     = "../../../dist"
}

variable "content_security_policy" {
  description = "Override the default CSP if needed"
  type        = string
  default     = null
}
