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

variable "allow_signups" {
  description = "Allow self-service sign-up. When false (default) the pool is invite-only (admin creates users)."
  type        = bool
  default     = false
}

variable "tags" {
  description = "Tags applied to all resources"
  type        = map(string)
  default     = {}
}
