data "aws_route53_zone" "root" {
  name         = "${var.root_domain}."
  private_zone = false
}

# Edge certificate MUST live in us-east-1 regardless of the app region.
provider "aws" {
  alias  = "us_east_1"
  region = "us-east-1"
}

resource "aws_acm_certificate" "app" {
  provider          = aws.us_east_1
  domain_name       = var.app_fqdn
  validation_method = "DNS"

  tags = var.tags

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_route53_record" "app_validation" {
  provider = aws.us_east_1
  for_each = {
    for dvo in aws_acm_certificate.app.domain_validation_options : dvo.domain_name => {
      name   = dvo.resource_record_name
      type   = dvo.resource_record_type
      record = dvo.resource_record_value
    }
  }

  zone_id = data.aws_route53_zone.root.zone_id
  name    = each.value.name
  type    = each.value.type
  ttl     = 60
  records = [each.value.record]
}

resource "aws_acm_certificate_validation" "app" {
  provider                = aws.us_east_1
  certificate_arn         = aws_acm_certificate.app.arn
  validation_record_fqdns = [for record in aws_route53_record.app_validation : record.fqdn]
}

# Auth (Cognito hosted UI) edge certificate. Cognito requires its custom
# domain certificate to live in us-east-1, same as CloudFront.
resource "aws_acm_certificate" "auth" {
  count             = var.auth_fqdn == null ? 0 : 1
  provider          = aws.us_east_1
  domain_name       = var.auth_fqdn
  validation_method = "DNS"

  tags = var.tags

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_route53_record" "auth_validation" {
  provider = aws.us_east_1
  for_each = var.auth_fqdn == null ? {} : {
    for dvo in aws_acm_certificate.auth[0].domain_validation_options : dvo.domain_name => {
      name   = dvo.resource_record_name
      type   = dvo.resource_record_type
      record = dvo.resource_record_value
    }
  }

  zone_id = data.aws_route53_zone.root.zone_id
  name    = each.value.name
  type    = each.value.type
  ttl     = 60
  records = [each.value.record]
}

resource "aws_acm_certificate_validation" "auth" {
  count                   = var.auth_fqdn == null ? 0 : 1
  provider                = aws.us_east_1
  certificate_arn         = aws_acm_certificate.auth[0].arn
  validation_record_fqdns = [for record in aws_route53_record.auth_validation : record.fqdn]
}

# Site certificate for the public marketing site. Validation reuses the same
# DNS pattern. Built only when create_site_cert is enabled.
resource "aws_acm_certificate" "site" {
  count                     = var.create_site_cert ? 1 : 0
  provider                  = aws.us_east_1
  domain_name               = var.site_fqdn
  subject_alternative_names = ["www.${var.site_fqdn}"]
  validation_method         = "DNS"

  tags = var.tags

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_route53_record" "site_validation" {
  provider = aws.us_east_1
  for_each = var.create_site_cert ? {
    for dvo in aws_acm_certificate.site[0].domain_validation_options : dvo.domain_name => {
      name   = dvo.resource_record_name
      type   = dvo.resource_record_type
      record = dvo.resource_record_value
    }
  } : {}

  zone_id = data.aws_route53_zone.root.zone_id
  name    = each.value.name
  type    = each.value.type
  ttl     = 60
  records = [each.value.record]
}

resource "aws_acm_certificate_validation" "site" {
  count                   = var.create_site_cert ? 1 : 0
  provider                = aws.us_east_1
  certificate_arn         = aws_acm_certificate.site[0].arn
  validation_record_fqdns = [for record in aws_route53_record.site_validation : record.fqdn]
}
