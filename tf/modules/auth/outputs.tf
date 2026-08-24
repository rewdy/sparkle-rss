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
  value = "https://${aws_cognito_user_pool_domain.this.domain}.auth.${data.aws_region.current.region}.amazoncognito.com"
}

output "cognito_endpoint_origin" {
  description = "Origin used by browsers for OIDC discovery/JWKS (CSP connect-src)"
  value       = "https://cognito-idp.${data.aws_region.current.region}.amazonaws.com"
}
