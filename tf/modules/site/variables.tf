variable "site_fqdn" {
  description = "Hostname serving the site (the apex, e.g. sparklerss.com)"
  type        = string
}

variable "www_fqdn" {
  description = "www hostname that 301-redirects to site_fqdn (e.g. www.sparklerss.com)"
  type        = string
}

variable "certificate_arn" {
  description = "ACM certificate ARN in us-east-1 covering site_fqdn and www_fqdn"
  type        = string
}

variable "route53_zone_id" {
  description = "Hosted zone to create the alias records in"
  type        = string
}

variable "tags" {
  description = "Tags applied to created resources"
  type        = map(string)
  default     = {}
}