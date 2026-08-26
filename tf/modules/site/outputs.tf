output "distribution_id" {
  value = aws_cloudfront_distribution.this.id
}

output "assets_bucket_name" {
  value = aws_s3_bucket.site.bucket
}

output "site_url" {
  value = "https://${var.site_fqdn}"
}