output "execute_api_domain" {
  description = "Regional hostname CloudFront uses as the API origin"
  value       = "${aws_apigatewayv2_api.this.id}.execute-api.${data.aws_region.current.region}.amazonaws.com"
}
