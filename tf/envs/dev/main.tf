provider "aws" {
  region = "us-east-1"
  default_tags {
    tags = {
      project = "sparkle-rss"
      env     = "dev"
    }
  }
}

module "db" {
  source = "../../modules/db"

  allowed_principal_arns = [var.deployer_principal_arn]
  tags                   = { component = "db" }
}
