variable "root_domain" {
  description = "Apex domain whose Route53 hosted zone already exists (e.g. sparklerss.com). Derived as the parent of app_fqdn."
  type        = string
}

variable "app_fqdn" {
  description = "Full hostname serving the app (e.g. app.sparklerss.com)"
  type        = string
}

variable "tags" {
  description = "Tags applied to created resources"
  type        = map(string)
  default     = {}
}

variable "create_site_cert" {
  description = "Also provision a validated us-east-1 cert covering the site domain + www for the marketing site"
  type        = bool
  default     = false
}

variable "site_fqdn" {
  description = "Full hostname serving the marketing site (apex or subdomain). Only used when create_site_cert is true."
  type        = string
  default     = null
}
