output "distribution_id" {
  value = aws_cloudfront_distribution.this.id
}

output "assets_bucket_name" {
  value = aws_s3_bucket.assets.bucket
}

output "app_url" {
  value = "https://${var.app_fqdn}"
}
