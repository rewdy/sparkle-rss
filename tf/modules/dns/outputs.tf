output "zone_id" {
  value = data.aws_route53_zone.root.zone_id
}

output "app_fqdn" {
  value = "${var.app_hostname}.${var.root_domain}"
}

output "certificate_arn" {
  description = "Validated us-east-1 certificate for the app hostname"
  value       = aws_acm_certificate_validation.app.certificate_arn
}
