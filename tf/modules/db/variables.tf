variable "allowed_principal_arns" {
  description = "IAM principal ARNs allowed to connect to the cluster"
  type        = list(string)
}

variable "tags" {
  description = "Tags applied to all resources"
  type        = map(string)
  default     = {}
}
