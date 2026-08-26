resource "aws_s3_bucket" "site" {
  bucket_prefix = "sparkle-rss-site-"
  tags          = var.tags
}

resource "aws_s3_bucket_public_access_block" "site" {
  bucket                  = aws_s3_bucket.site.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "site" {
  bucket = aws_s3_bucket.site.id
  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

data "aws_iam_policy_document" "oac_access" {
  statement {
    sid       = "AllowCloudFrontOAC"
    effect    = "Allow"
    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.site.arn}/*"]
    principals {
      type        = "Service"
      identifiers = ["cloudfront.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "AWS:SourceArn"
      values   = [aws_cloudfront_distribution.this.arn]
    }
  }
}

resource "aws_s3_bucket_policy" "site" {
  bucket     = aws_s3_bucket.site.id
  policy     = data.aws_iam_policy_document.oac_access.json
  depends_on = [aws_cloudfront_distribution.this]
}

# One CloudFront Function does two jobs at the viewer edge:
#  1. www.sparklerss.com -> sparklerss.com (301, preserving the path)
#  2. rewrite pretty URLs to the index.html files Astro emitted (S3 REST
#     origins don't auto-serve index.html for directory paths).
locals {
  viewer_source = <<-JS
    function handler(event) {
      var request = event.request;
      var host = request.headers.host ? request.headers.host.value : '';

      if (host.indexOf('www.') === 0) {
        var apex = host.substring(4);
        return {
          statusCode: 301,
          statusDescription: 'Moved Permanently',
          headers: {
            location: { value: 'https://' + apex + request.uri }
          }
        };
      }

      var uri = request.uri;
      if (uri === '/' || uri === '') {
        request.uri = '/index.html';
      } else if (uri === '/setup' || uri === '/setup/') {
        request.uri = '/setup/index.html';
      }
      return request;
    }
  JS

  security_headers_policy_name = "sparkle-rss-site-security-headers-${replace(var.site_fqdn, ".", "-")}"
}

resource "aws_cloudfront_function" "viewer_rewrite" {
  name    = "sparkle-rss-site-rewrite-${replace(var.site_fqdn, ".", "-")}"
  runtime = "cloudfront-js-2.0"
  comment = "Redirect www to apex and map pretty URLs to index.html for the marketing site"
  publish = true
  code    = local.viewer_source
}

resource "aws_cloudfront_response_headers_policy" "security_headers" {
  name    = local.security_headers_policy_name
  comment = "Security headers for the sparkle rss marketing site"

  security_headers_config {
    strict_transport_security {
      override                   = true
      include_subdomains         = true
      preload                    = false
      access_control_max_age_sec = 31536000
    }
    content_type_options {
      override = true
    }
    frame_options {
      override     = true
      frame_option = "DENY"
    }
    referrer_policy {
      override        = true
      referrer_policy = "strict-origin-when-cross-origin"
    }
    content_security_policy {
      override                = true
      content_security_policy = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: https:; media-src 'self' https:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
    }
  }
}

data "aws_cloudfront_cache_policy" "caching_optimized" {
  name = "Managed-CachingOptimized"
}

resource "aws_cloudfront_distribution" "this" {
  enabled         = true
  is_ipv6_enabled = true
  comment         = "sparkle-rss marketing site (apex + www)"

  origin {
    domain_name              = aws_s3_bucket.site.bucket_regional_domain_name
    origin_id                = "s3-site"
    origin_access_control_id = aws_cloudfront_origin_access_control.site.id
  }

  default_cache_behavior {
    target_origin_id           = "s3-site"
    allowed_methods            = ["GET", "HEAD", "OPTIONS"]
    cached_methods             = ["GET", "HEAD"]
    viewer_protocol_policy     = "redirect-to-https"
    cache_policy_id            = data.aws_cloudfront_cache_policy.caching_optimized.id
    compress                   = true
    response_headers_policy_id = aws_cloudfront_response_headers_policy.security_headers.id
    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.viewer_rewrite.arn
    }
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    acm_certificate_arn      = var.certificate_arn
    ssl_support_method       = "sni-only"
    minimum_protocol_version = "TLSv1.2_2021"
  }

  aliases = [var.site_fqdn, var.www_fqdn]

  tags = var.tags
}

resource "aws_cloudfront_origin_access_control" "site" {
  name                              = "sparkle-rss-oac-site-${replace(var.site_fqdn, ".", "-")}"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

resource "aws_route53_record" "site_alias" {
  zone_id = var.route53_zone_id
  name    = var.site_fqdn
  type    = "A"

  alias {
    name                   = aws_cloudfront_distribution.this.domain_name
    zone_id                = aws_cloudfront_distribution.this.hosted_zone_id
    evaluate_target_health = false
  }
}

resource "aws_route53_record" "site_alias_v6" {
  zone_id = var.route53_zone_id
  name    = var.site_fqdn
  type    = "AAAA"

  alias {
    name                   = aws_cloudfront_distribution.this.domain_name
    zone_id                = aws_cloudfront_distribution.this.hosted_zone_id
    evaluate_target_health = false
  }
}

resource "aws_route53_record" "www_alias" {
  zone_id = var.route53_zone_id
  name    = var.www_fqdn
  type    = "A"

  alias {
    name                   = aws_cloudfront_distribution.this.domain_name
    zone_id                = aws_cloudfront_distribution.this.hosted_zone_id
    evaluate_target_health = false
  }
}

resource "aws_route53_record" "www_alias_v6" {
  zone_id = var.route53_zone_id
  name    = var.www_fqdn
  type    = "AAAA"

  alias {
    name                   = aws_cloudfront_distribution.this.domain_name
    zone_id                = aws_cloudfront_distribution.this.hosted_zone_id
    evaluate_target_health = false
  }
}