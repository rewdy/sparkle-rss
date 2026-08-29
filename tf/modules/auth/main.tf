terraform {
  required_version = ">= 1.10"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }
}

data "aws_region" "current" {}

resource "random_id" "domain_suffix" {
  byte_length = 4
}

# Invite-only by default: sign-up disabled, users are created by admins.
# Sign-in uses the Cognito username (greader ClientLogin parity).
resource "aws_cognito_user_pool" "this" {
  name = "${var.name_prefix}-pool"

  mfa_configuration = "OFF"

  admin_create_user_config {
    allow_admin_create_user_only = !var.allow_signups
  }

  password_policy {
    minimum_length                   = 12
    require_lowercase                = true
    require_numbers                  = true
    require_symbols                  = true
    require_uppercase                = true
    temporary_password_validity_days = 7
  }

  tags = var.tags
}

resource "aws_cognito_user_pool_domain" "this" {
  # With a custom domain, `domain` is the full FQDN; otherwise it is the
  # amazoncognito.com prefix. New domains default to managed login branding.
  domain          = coalesce(var.custom_domain_fqdn, "${var.name_prefix}-${random_id.domain_suffix.hex}")
  certificate_arn = var.custom_domain_fqdn == null ? null : var.custom_domain_certificate_arn
  user_pool_id    = aws_cognito_user_pool.this.id

  lifecycle {
    precondition {
      condition     = var.custom_domain_fqdn == null || var.custom_domain_certificate_arn != null
      error_message = "custom_domain_certificate_arn is required when custom_domain_fqdn is set (must be a validated us-east-1 certificate)."
    }
  }
}

resource "aws_route53_record" "hosted_ui_alias" {
  count = var.custom_domain_fqdn == null ? 0 : 1

  zone_id = var.route53_zone_id
  name    = var.custom_domain_fqdn
  type    = "A"

  alias {
    name                   = aws_cognito_user_pool_domain.this.cloudfront_distribution
    zone_id                = aws_cognito_user_pool_domain.this.cloudfront_distribution_zone_id
    evaluate_target_health = false
  }
}

# Managed login styling for the SPA client. Settings are the editor's JSON
# schema (colors/spacing/component styles); raw CSS is not supported by
# managed login. Assets can be added later via the console without touching
# this resource.
resource "aws_cognito_managed_login_branding" "spa" {
  client_id    = aws_cognito_user_pool_client.spa.id
  user_pool_id = aws_cognito_user_pool.this.id
  settings     = var.branding_settings
}

resource "aws_cognito_user_pool_client" "spa" {
  name         = "${var.name_prefix}-spa"
  user_pool_id = aws_cognito_user_pool.this.id

  generate_secret                      = false
  explicit_auth_flows                  = ["ALLOW_USER_SRP_AUTH", "ALLOW_REFRESH_TOKEN_AUTH", "ALLOW_ADMIN_USER_PASSWORD_AUTH"]
  allowed_oauth_flows_user_pool_client = true
  allowed_oauth_flows                  = ["code"]
  allowed_oauth_scopes                 = ["openid", "email", "profile", "offline_access"]
  supported_identity_providers         = ["COGNITO"]

  callback_urls = var.callback_urls
  logout_urls   = var.logout_urls

  access_token_validity  = 1
  id_token_validity      = 1
  refresh_token_validity = 30

  token_validity_units {
    access_token  = "hours"
    id_token      = "hours"
    refresh_token = "days"
  }
}
