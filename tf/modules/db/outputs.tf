data "aws_region" "current" {}

output "cluster_identifier" {
  value = aws_dsql_cluster.this.identifier
}

output "endpoint" {
  value = "${aws_dsql_cluster.this.identifier}.dsql.${data.aws_region.current.region}.on.aws"
}

output "cluster_arn" {
  value = "arn:aws:dsql:${data.aws_region.current.region}:${data.aws_caller_identity.current.account_id}:cluster/${aws_dsql_cluster.this.identifier}"
}
