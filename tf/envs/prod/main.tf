terraform {
  required_version = ">= 1.10"

  # Real values come from -backend-config flags (CI) or a local backend.conf.
  backend "s3" {}
}

locals {
  app_fqdn    = "${var.app_hostname}.${var.root_domain}"
  web_origins = concat(["https://${local.app_fqdn}"], var.enable_local_dev_callbacks ? ["http://localhost:5173"] : [])
  callback_urls = concat(
    ["https://${local.app_fqdn}/auth/callback"],
    var.enable_local_dev_callbacks ? ["http://localhost:5173/auth/callback"] : [],
  )
  logout_urls = concat(
    ["https://${local.app_fqdn}/"],
    var.enable_local_dev_callbacks ? ["http://localhost:5173/"] : [],
  )
}

provider "aws" {
  region = var.aws_region
  default_tags {
    tags = {
      project = "sparkle-rss"
      env     = "prod"
    }
  }
}

module "dns" {
  source       = "../../modules/dns"
  root_domain  = var.root_domain
  app_hostname = var.app_hostname
}

module "db" {
  source                 = "../../modules/db"
  allowed_principal_arns = [for role_arn in concat([module.github_oidc.deploy_role_arn]) : role_arn]
  tags                   = { component = "db" }
}

module "auth" {
  source        = "../../modules/auth"
  name_prefix   = "${var.name_prefix}-prod"
  callback_urls = local.callback_urls
  logout_urls   = local.logout_urls
}

resource "random_password" "greader_hmac" {
  length  = 64
  special = false
}

resource "aws_secretsmanager_secret" "greader_hmac" {
  name                    = "${var.name_prefix}/prod/greader-hmac-key"
  recovery_window_in_days = 0
  tags                    = { component = "auth" }
}

resource "aws_secretsmanager_secret_version" "greader_hmac" {
  secret_id     = aws_secretsmanager_secret.greader_hmac.id
  secret_string = random_password.greader_hmac.result
}

module "api" {
  source            = "../../modules/api"
  lambda_zip_path   = "${var.lambda_zip_dir}/api.zip"
  cognito_issuer    = module.auth.issuer
  cognito_client_id = module.auth.client_id
  web_origins       = local.web_origins
  dsql_cluster_arn  = module.db.cluster_arn
  dsql_endpoint     = module.db.endpoint
  hmac_secret_arn   = aws_secretsmanager_secret.greader_hmac.arn
  refresh_queue_url = module.ingest.refresh_queue_url
  refresh_queue_arn = module.ingest.refresh_queue_arn
}

locals {
  # Browser talks to Cognito for OIDC discovery/JWKS and (if needed) silent-renew iframes.
  csp_connect_origins = [
    module.auth.cognito_endpoint_origin,
    module.auth.hosted_ui_domain,
  ]
  csp_frame_origins   = [module.auth.hosted_ui_domain]
}

module "web" {
  source             = "../../modules/web"
  app_fqdn           = local.app_fqdn
  certificate_arn    = module.dns.certificate_arn
  route53_zone_id    = module.dns.zone_id
  api_gateway_domain = module.api.execute_api_domain
  extra_connect_src  = local.csp_connect_origins
  frame_src          = local.csp_frame_origins
  extra_security_headers = {
    content_security_policy = var.content_security_policy
  }
}

module "ingest" {
  source           = "../../modules/ingest"
  lambda_zip_dir   = var.lambda_zip_dir
  dsql_cluster_arn = module.db.cluster_arn
  dsql_endpoint    = module.db.endpoint
  alarm_email      = null # subscribe an email via console/SNS to receive alerts
}

module "github_oidc" {
  source               = "../../modules/github-oidc"
  github_repo          = var.github_repo
  create_oidc_provider = var.create_oidc_provider
  state_bucket_arns    = var.state_bucket_arns
}

output "app_url" {
  value = module.web.app_url
}

output "db_endpoint" {
  value     = module.db.endpoint
  sensitive = false
}

output "deploy_role_arn" {
  value       = module.github_oidc.deploy_role_arn
  description = "Assume this from GitHub Actions to deploy"
}

output "cognito_issuer" {
  value = module.auth.issuer
}

output "cognito_client_id" {
  value = module.auth.client_id
}

output "assets_bucket_name" {
  value = module.web.assets_bucket_name
}

output "distribution_id" {
  value = module.web.distribution_id
}
