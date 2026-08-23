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

module "auth" {
  source = "../../modules/auth"

  name_prefix   = "sparkle-dev"
  callback_urls = ["http://localhost:5173/auth/callback"]
  logout_urls   = ["http://localhost:5173/"]
  tags          = { component = "auth" }
}

output "db_cluster_identifier" {
  value = module.db.cluster_identifier
}

output "db_endpoint" {
  value = module.db.endpoint
}

output "cognito_user_pool_id" {
  value = module.auth.user_pool_id
}

output "cognito_client_id" {
  value = module.auth.client_id
}

output "cognito_issuer" {
  value = module.auth.issuer
}

output "cognito_hosted_ui_domain" {
  value = module.auth.hosted_ui_domain
}
