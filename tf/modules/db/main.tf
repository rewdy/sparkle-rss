terraform {
  required_version = ">= 1.10"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }
}

resource "aws_dsql_cluster" "this" {
  deletion_protection_enabled = false
  tags                        = var.tags
}

resource "aws_dsql_cluster_policy" "this" {
  identifier = aws_dsql_cluster.this.identifier
  policy     = data.aws_iam_policy_document.connect.json
}

data "aws_iam_policy_document" "connect" {
  version = "2012-10-17"

  statement {
    sid     = "SparkleDbConnect"
    effect  = "Allow"
    actions = ["dsql:DbConnect", "dsql:DbConnectAdmin"]

    principals {
      type        = "AWS"
      identifiers = var.allowed_principal_arns
    }

    resources = ["*"]
  }
}

data "aws_caller_identity" "current" {}
