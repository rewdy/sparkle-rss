data "aws_region" "current" {}

output "cluster_identifier" {
  value = aws_dsql_cluster.this.identifier
}

output "endpoint" {
  value = "${aws_dsql_cluster.this.identifier}.dsql.${data.aws_region.current.region}.on.aws"
}
