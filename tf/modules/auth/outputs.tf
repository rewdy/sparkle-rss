output "user_pool_id" {
  value = aws_cognito_user_pool.this.id
}

output "client_id" {
  value = aws_cognito_user_pool_client.spa.id
}

output "issuer" {
  description = "OIDC issuer URL (token issuer + JWKS base)"
  value       = "https://cognito-idp.${data.aws_region.current.region}.amazonaws.com/${aws_cognito_user_pool.this.id}"
}

output "hosted_ui_domain" {
  description = "Base URL of the hosted UI (custom domain when configured, otherwise the amazoncognito.com prefix domain)"
  value       = var.custom_domain_fqdn == null ? "https://${aws_cognito_user_pool_domain.this.domain}.auth.${data.aws_region.current.region}.amazoncognito.com" : "https://${var.custom_domain_fqdn}"
}

output "cognito_endpoint_origin" {
  description = "Origin used by browsers for OIDC discovery/JWKS (CSP connect-src)"
  value       = "https://cognito-idp.${data.aws_region.current.region}.amazonaws.com"
}
