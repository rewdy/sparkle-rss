variable "lambda_zip_dir" {
  description = "Directory containing built lambda zips"
  type        = string
}

variable "dsql_cluster_arn" {
  type = string
}

variable "dsql_endpoint" {
  type = string
}

variable "alarm_email" {
  description = "Optional email subscribed to the alerts topic (must confirm)"
  type        = string
  default     = null
}

variable "tags" {
  type    = map(string)
  default = {}
}
