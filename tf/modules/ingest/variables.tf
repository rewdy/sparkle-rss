variable "lambda_zip_dir" {
  description = "Directory containing built lambda zips"
  type        = string
}

variable "tags" {
  type    = map(string)
  default = {}
}
