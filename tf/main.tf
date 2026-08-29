terraform {
  required_version = ">= 1.10"

  # State backend is configured inline — no -backend-config flags or env vars
  # needed. Forks change these four values to point at their own bucket.
  backend "s3" {
    bucket       = "drewmey--devops-tf-state"
    key          = "sparkle-rss/prod/terraform.tfstate"
    region       = "us-east-1"
    use_lockfile = true
  }
}

locals {
  # The hosted zone is the parent of the app domain (app.example.com -> example.com).
  root_domain = join(".", slice(split(".", var.app_domain), 1, length(split(".", var.app_domain))))
  app_fqdn    = var.app_domain
  site_fqdn   = var.site_domain
  # Hosted UI lives on its own subdomain of the same zone.
  auth_fqdn   = "auth.${local.root_domain}"
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

# Clear error if a fork requests the site but misconfigures its domain.
resource "terraform_data" "site_domain_check" {
  lifecycle {
    precondition {
      condition     = !var.deploy_site || (var.site_domain != null && (var.site_domain == local.root_domain || endswith(var.site_domain, ".${local.root_domain}")))
      error_message = "When deploy_site is true, site_domain must be set and live within the app_domain's hosted zone (${local.root_domain})."
    }
  }
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
  source           = "./modules/dns"
  root_domain      = local.root_domain
  app_fqdn         = local.app_fqdn
  create_site_cert = var.deploy_site
  site_fqdn        = local.site_fqdn
  auth_fqdn        = local.auth_fqdn
}

module "db" {
  source                 = "./modules/db"
  allowed_principal_arns = [for role_arn in concat([module.github_oidc.deploy_role_arn]) : role_arn]
  tags                   = { component = "db" }
}

module "auth" {
  source                        = "./modules/auth"
  name_prefix                   = "${var.name_prefix}-prod"
  callback_urls                 = local.callback_urls
  logout_urls                   = local.logout_urls
  allow_signups                 = var.allow_signups
  custom_domain_fqdn            = local.auth_fqdn
  custom_domain_certificate_arn = module.dns.auth_certificate_arn
  route53_zone_id               = module.dns.zone_id
  branding_settings             = local.managed_login_settings
}

# Managed login styling for the Cognito hosted UI. The AWS managed-login
# Settings schema is categories/componentClasses/components; the earlier
# colorScheme/componentClasses.{containers,inputs} keys were rejected by AWS
# (UnknownProperty), which broke `terraform apply`. Radius + dark-mode scheme
# are restored below; custom palette colors are deferred (add them via a
# DescribeManagedLoginBrandingByClient read-modify-write, not by guessing).
locals {
  managed_login_settings = jsonencode({
    categories = {
      global = {
        colorSchemeMode = "DARK"
      }
    }
    componentClasses = {
      buttons = { borderRadius = 3 }
      input   = { borderRadius = 2 }
    }
    components = {
      form = { borderRadius = 4 }
    }
  })
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
  source            = "./modules/api"
  lambda_zip_path   = "${var.lambda_zip_dir}/api.zip"
  cognito_issuer    = module.auth.issuer
  cognito_client_id = module.auth.client_id
  web_origins       = local.web_origins
  dsql_cluster_arn  = module.db.cluster_arn
  dsql_endpoint     = module.db.endpoint
  hmac_secret_arn   = aws_secretsmanager_secret.greader_hmac.arn
  refresh_queue_url = module.ingest.refresh_queue_url
  refresh_queue_arn = module.ingest.refresh_queue_arn
  media_bucket_name = module.ingest.media_bucket_name
  media_bucket_arn  = module.ingest.media_bucket_arn
}

locals {
  # Browser talks to Cognito for OIDC discovery/JWKS and (if needed) silent-renew iframes.
  csp_connect_origins = [
    module.auth.cognito_endpoint_origin,
    module.auth.hosted_ui_domain,
  ]
  csp_frame_origins = [module.auth.hosted_ui_domain]
}

module "web" {
  source             = "./modules/web"
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

module "site" {
  count           = var.deploy_site ? 1 : 0
  source          = "./modules/site"
  site_fqdn       = local.site_fqdn
  www_fqdn        = "www.${local.site_fqdn}"
  certificate_arn = module.dns.site_certificate_arn
  route53_zone_id = module.dns.zone_id
  tags            = { component = "site" }
}

module "ingest" {
  source           = "./modules/ingest"
  depends_on       = [module.github_oidc]
  lambda_zip_dir   = var.lambda_zip_dir
  dsql_cluster_arn = module.db.cluster_arn
  dsql_endpoint    = module.db.endpoint
  alarm_email      = var.alarm_email
}

module "github_oidc" {
  source               = "./modules/github-oidc"
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

output "plan_role_arn" {
  value       = module.github_oidc.plan_role_arn
  description = "Read-only role PRs assume to render `terraform plan` output"
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

output "site_url" {
  value = var.deploy_site ? module.site[0].site_url : ""
}

output "site_bucket_name" {
  value = var.deploy_site ? module.site[0].assets_bucket_name : ""
}

output "site_distribution_id" {
  value = var.deploy_site ? module.site[0].distribution_id : ""
}
