variable "lambda_zip_path" {
  description = "Path to the built api.zip bundle"
  type        = string
}

variable "cognito_issuer" {
  type = string
}

variable "cognito_client_id" {
  type = string
}

variable "web_origins" {
  description = "Origins allowed by CORS in the API layer"
  type        = list(string)
}

variable "tags" {
  type    = map(string)
  default = {}
}

variable "dsql_cluster_arn" {
  type = string
}

variable "dsql_endpoint" {
  type = string
}
