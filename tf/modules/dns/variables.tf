variable "root_domain" {
  description = "Registered apex domain whose Route53 hosted zone already exists (e.g. sparklerss.com)"
  type        = string
}

variable "app_hostname" {
  description = "Hostname serving the app under the root domain (e.g. app)"
  type        = string
}

variable "tags" {
  description = "Tags applied to created resources"
  type        = map(string)
  default     = {}
}
