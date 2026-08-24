resource "aws_s3_bucket" "assets" {
  bucket_prefix = "sparkle-rss-web-"
  tags          = var.tags
}

resource "aws_s3_bucket_public_access_block" "assets" {
  bucket                  = aws_s3_bucket.assets.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "assets" {
  bucket = aws_s3_bucket.assets.id
  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

data "aws_iam_policy_document" "oac_access" {
  statement {
    sid       = "AllowCloudFrontOAC"
    effect    = "Allow"
    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.assets.arn}/*"]
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

resource "aws_s3_bucket_policy" "assets" {
  bucket     = aws_s3_bucket.assets.id
  policy     = data.aws_iam_policy_document.oac_access.json
  depends_on = [aws_cloudfront_distribution.this]
}

locals {
  connect_src = join(" ", concat(["'self'"], var.extra_connect_src))
  frame_src   = join(" ", var.frame_src)

  spa_rewrite_source = <<-JS
    function handler(event) {
      var request = event.request;
      var uri = request.uri;
      if (uri.startsWith('/api/') || uri === '/api') {
        return request;
      }
      var lastSegment = uri.split('/').pop();
      if (!lastSegment.includes('.') && !uri.endsWith('/')) {
        request.uri = '/index.html';
      } else if (uri.endsWith('/')) {
        request.uri = uri + 'index.html';
      }
      return request;
    }
  JS


  csp = coalesce(
    try(var.extra_security_headers.content_security_policy, null),
    join("; ", compact([
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: https:",
      "media-src 'self' https:",
      "font-src 'self' data:",
      length(var.extra_connect_src) > 0 ? "connect-src ${local.connect_src}" : null,
      length(var.frame_src) > 0 ? "frame-src ${local.frame_src}" : null,
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ])),
  )
}

resource "aws_cloudfront_function" "spa_rewrite" {
  name    = "sparkle-rss-spa-rewrite-${replace(var.app_fqdn, ".", "-")}"
  runtime = "cloudfront-js-2.0"
  comment = "Rewrite SPA routes to /index.html (never touches /api/*)"
  publish = true
  code    = local.spa_rewrite_source
}

resource "aws_cloudfront_response_headers_policy" "security_headers" {
  name    = "sparkle-rss-security-headers-${replace(var.app_fqdn, ".", "-")}"
  comment = "Security headers for sparkle-rss"

  security_headers_config {
    content_security_policy {
      override                = true
      content_security_policy = local.csp
    }
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
  }
}

data "aws_cloudfront_cache_policy" "caching_disabled" {
  name = "Managed-CachingDisabled"
}

data "aws_cloudfront_cache_policy" "caching_optimized" {
  name = "Managed-CachingOptimized"
}

data "aws_cloudfront_origin_request_policy" "all_viewer_except_host" {
  name = "Managed-AllViewerExceptHostHeader"
}

resource "aws_cloudfront_distribution" "this" {
  enabled         = true
  is_ipv6_enabled = true
  comment         = "sparkle-rss web + api edge"

  origin {
    domain_name              = aws_s3_bucket.assets.bucket_regional_domain_name
    origin_id                = "s3-assets"
    origin_access_control_id = aws_cloudfront_origin_access_control.assets.id
  }

  origin {
    domain_name = var.api_gateway_domain
    origin_id   = "api-gateway"
    custom_origin_config {
      http_port              = 80
      https_port             = 443
      origin_protocol_policy = "https-only"
      origin_ssl_protocols   = ["TLSv1.2"]
    }
  }

  default_cache_behavior {
    target_origin_id           = "s3-assets"
    allowed_methods            = ["GET", "HEAD", "OPTIONS"]
    cached_methods             = ["GET", "HEAD"]
    viewer_protocol_policy     = "redirect-to-https"
    cache_policy_id            = data.aws_cloudfront_cache_policy.caching_optimized.id
    compress                   = true
    response_headers_policy_id = aws_cloudfront_response_headers_policy.security_headers.id
    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.spa_rewrite.arn
    }
  }

  ordered_cache_behavior {
    path_pattern               = "/api/*"
    target_origin_id           = "api-gateway"
    viewer_protocol_policy     = "https-only"
    allowed_methods            = ["GET", "HEAD", "OPTIONS", "PUT", "POST", "PATCH", "DELETE"]
    cached_methods             = ["GET", "HEAD"]
    cache_policy_id            = data.aws_cloudfront_cache_policy.caching_disabled.id
    origin_request_policy_id   = data.aws_cloudfront_origin_request_policy.all_viewer_except_host.id
    response_headers_policy_id = aws_cloudfront_response_headers_policy.security_headers.id
    compress                   = true
  }

  # FreshRSS-parity clients may call /greader.php without the /api prefix.
  ordered_cache_behavior {
    path_pattern               = "/greader.php"
    target_origin_id           = "api-gateway"
    viewer_protocol_policy     = "https-only"
    allowed_methods            = ["GET", "HEAD", "OPTIONS", "PUT", "POST", "PATCH", "DELETE"]
    cached_methods             = ["GET", "HEAD"]
    cache_policy_id            = data.aws_cloudfront_cache_policy.caching_disabled.id
    origin_request_policy_id   = data.aws_cloudfront_origin_request_policy.all_viewer_except_host.id
    response_headers_policy_id = aws_cloudfront_response_headers_policy.security_headers.id
    compress                   = true
  }

  ordered_cache_behavior {
    path_pattern               = "/greader.php/*"
    target_origin_id           = "api-gateway"
    viewer_protocol_policy     = "https-only"
    allowed_methods            = ["GET", "HEAD", "OPTIONS", "PUT", "POST", "PATCH", "DELETE"]
    cached_methods             = ["GET", "HEAD"]
    cache_policy_id            = data.aws_cloudfront_cache_policy.caching_disabled.id
    origin_request_policy_id   = data.aws_cloudfront_origin_request_policy.all_viewer_except_host.id
    response_headers_policy_id = aws_cloudfront_response_headers_policy.security_headers.id
    compress                   = true
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

  aliases = [var.app_fqdn]

  tags = var.tags
}

resource "aws_cloudfront_origin_access_control" "assets" {
  name                              = "sparkle-rss-oac-${replace(var.app_fqdn, ".", "-")}"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

resource "aws_route53_record" "app_alias" {
  zone_id = var.route53_zone_id
  name    = var.app_fqdn
  type    = "A"

  alias {
    name                   = aws_cloudfront_distribution.this.domain_name
    zone_id                = aws_cloudfront_distribution.this.hosted_zone_id
    evaluate_target_health = false
  }
}

resource "aws_route53_record" "app_alias_v6" {
  zone_id = var.route53_zone_id
  name    = var.app_fqdn
  type    = "AAAA"

  alias {
    name                   = aws_cloudfront_distribution.this.domain_name
    zone_id                = aws_cloudfront_distribution.this.hosted_zone_id
    evaluate_target_health = false
  }
}
