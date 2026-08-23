data "aws_iam_policy_document" "github_trust" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRoleWithWebIdentity"]
    principals {
      type        = "Federated"
      identifiers = [var.create_oidc_provider ? aws_iam_openid_connect_provider.github[0].arn : data.aws_iam_openid_connect_provider.github[0].arn]
    }
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }
    condition {
      test     = "StringLike"
      variable = "token.actions.githubusercontent.com:sub"
      values = [
        "repo:${var.github_repo}:ref:refs/heads/main",
        "repo:${var.github_repo}:pull_request",
      ]
    }
  }
}

resource "aws_iam_openid_connect_provider" "github" {
  count           = var.create_oidc_provider ? 1 : 0
  url             = "https://token.actions.githubusercontent.com"
  client_id_list  = ["sts.amazonaws.com"]
  thumbprint_list = ["6938fd4d98bab03faadb97b34396831e3780aea1"]
}

# AWS ignores OIDC thumbprints for known providers; the value above is the
# historic GitHub root thumbprint kept for schema compatibility.

data "aws_iam_openid_connect_provider" "github" {
  count = var.create_oidc_provider ? 0 : 1
  url   = "https://token.actions.githubusercontent.com"
}

resource "aws_iam_role" "deploy" {
  name               = "sparkle-rss-github-deploy"
  assume_role_policy = data.aws_iam_policy_document.github_trust.json
  tags               = var.tags
}

locals {
  service_write_actions = [
    "cloudfront:*",
    "apigateway:*",
    "lambda:*",
    "cognito-idp:*",
    "dsql:*",
    "sqs:*",
    "scheduler:*",
    "logs:*",
    "route53:ListHostedZones*",
    "route53:GetHostedZone",
    "route53:ChangeResourceRecordSets",
    "route53:ListResourceRecordSets",
    "acm:*",
  ]
}

data "aws_iam_policy_document" "deploy" {
  statement {
    sid       = "ManagedServices"
    effect    = "Allow"
    actions   = local.service_write_actions
    resources = ["*"]
  }

  statement {
    sid       = "WebAssetsBucket"
    effect    = "Allow"
    actions   = ["s3:*"]
    resources = ["arn:aws:s3:::sparkle-rss-web-*", "arn:aws:s3:::sparkle-rss-web-*/*"]
  }

  statement {
    sid       = "TerraformStateBucket"
    effect    = "Allow"
    actions   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject", "s3:ListBucket"]
    resources = concat(var.state_bucket_arns, [for arn in var.state_bucket_arns : "${arn}/*"])
  }

  statement {
    sid       = "IamScoped"
    effect    = "Allow"
    actions   = ["iam:CreateRole", "iam:DeleteRole", "iam:GetRole", "iam:PassRole", "iam:TagRole", "iam:UpdateAssumeRolePolicy", "iam:PutRolePolicy", "iam:DeleteRolePolicy", "iam:GetRolePolicy", "iam:AttachRolePolicy", "iam:DetachRolePolicy", "iam:ListAttachedRolePolicies", "iam:ListRolePolicies"]
    resources = ["arn:aws:iam::*:role/sparkle-rss-*", "arn:aws:iam::*:role/sparkle-rss-scheduler-invoke"]
  }

  statement {
    sid       = "IamRead"
    effect    = "Allow"
    actions   = ["iam:ListRoles", "iam:GetPolicyVersion", "iam:GetPolicy", "sts:GetCallerIdentity"]
    resources = ["*"]
  }
}

resource "aws_iam_role_policy" "deploy" {
  role   = aws_iam_role.deploy.name
  policy = data.aws_iam_policy_document.deploy.json
}
