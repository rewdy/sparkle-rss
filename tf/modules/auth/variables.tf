variable "name_prefix" {
  description = "Prefix for pool/client/domain names (must be DNS-safe)"
  type        = string
}

variable "callback_urls" {
  description = "OAuth2 callback URLs allowed for the SPA client"
  type        = list(string)
}

variable "logout_urls" {
  description = "Post-logout redirect URLs for the SPA client"
  type        = list(string)
  default     = []
}

variable "web_origins" {
  description = "Allowed OAuth2 origins for the SPA client (required so the browser can POST refresh-token grants to the token endpoint)"
  type        = list(string)
  default     = []
}

variable "allow_signups" {
  description = "Allow self-service sign-up. When false (default) the pool is invite-only (admin creates users)."
  type        = bool
  default     = false
}

variable "custom_domain_fqdn" {
  description = "Custom hostname for the hosted UI (e.g. auth.example.com). null keeps the amazoncognito.com prefix domain."
  type        = string
  default     = null
}

variable "custom_domain_certificate_arn" {
  description = "Validated us-east-1 ACM certificate ARN for custom_domain_fqdn (required when custom_domain_fqdn is set)"
  type        = string
  default     = null
}

variable "route53_zone_id" {
  description = "Hosted zone id for the Route53 alias record of the custom domain (required when custom_domain_fqdn is set)"
  type        = string
  default     = null
}

variable "branding_settings" {
  description = "Managed login branding settings JSON (colors, spacing, component styles). null uses Cognito defaults."
  type        = string
  default     = null
}

variable "tags" {
  description = "Tags applied to all resources"
  type        = map(string)
  default     = {}
}
