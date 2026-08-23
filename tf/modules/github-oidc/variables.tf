terraform {
  required_version = ">= 1.10"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }
}

variable "github_repo" {
  description = "GitHub repository allowed to assume the deploy role (owner/name)"
  type        = string
}

variable "create_oidc_provider" {
  description = "Set false if the account already has a GitHub OIDC provider registered"
  type        = bool
  default     = true
}

variable "state_bucket_arns" {
  description = "Terraform state bucket ARNs the pipeline needs access to"
  type        = list(string)
}

variable "tags" {
  type    = map(string)
  default = {}
}
