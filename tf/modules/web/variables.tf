variable "app_fqdn" {
  description = "Fully qualified hostname serving the app (e.g. app.sparklerss.com)"
  type        = string
}

variable "certificate_arn" {
  description = "ACM certificate ARN in us-east-1"
  type        = string
}

variable "route53_zone_id" {
  description = "Hosted zone to create the app alias record in"
  type        = string
}

variable "api_gateway_domain" {
  description = "Regional domain of the HTTP API (execute-api hostname)"
  type        = string
}

variable "extra_security_headers" {
  description = "Tweak content-security-policy without touching module internals"
  type = object({
    content_security_policy = optional(string)
  })
  default = {}
}

variable "tags" {
  description = "Tags applied to created resources"
  type        = map(string)
  default     = {}
}
