output "zone_id" {
  value = data.aws_route53_zone.root.zone_id
}

output "app_fqdn" {
  value = var.app_fqdn
}

output "certificate_arn" {
  description = "Validated us-east-1 certificate for the app hostname"
  value       = aws_acm_certificate_validation.app.certificate_arn
}

output "site_certificate_arn" {
  description = "Validated us-east-1 certificate for the site + www (empty unless create_site_cert)"
  value       = var.create_site_cert ? aws_acm_certificate_validation.site[0].certificate_arn : ""
}
