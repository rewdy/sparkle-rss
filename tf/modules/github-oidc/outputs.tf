output "deploy_role_arn" {
  value = aws_iam_role.deploy.arn
}

output "plan_role_arn" {
  description = "Read-only role PRs assume to render `terraform plan` output"
  value       = aws_iam_role.plan.arn
}
