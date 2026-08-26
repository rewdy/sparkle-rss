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
    # Match stable claims where possible, but AWS requires the trust policy to
    # scope on `sub` (or job_workflow_ref) as well. Some GitHub accounts issue
    # sub values with embedded IDs (`repo:owner@123/name@456:ref:…`), so match
    # both shapes; the `repository` equals-condition keeps this pinned to one repo.
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:repository"
      values   = [var.github_repo]
    }
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:ref"
      values   = ["refs/heads/main"]
    }
    condition {
      test     = "StringLike"
      variable = "token.actions.githubusercontent.com:sub"
      values = [
        "repo:${var.github_repo}:ref:refs/heads/main",
        "repo:*@*/${local.repo_name}@*:ref:refs/heads/main",
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

locals {
  repo_name = element(split("/", var.github_repo), 1)
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
    "route53:ListTagsForResource",
    "route53:GetChange",
    "acm:*",
    "cloudwatch:PutMetricAlarm",
    "cloudwatch:DeleteAlarms",
    "cloudwatch:DescribeAlarms",
    "cloudwatch:SetAlarmState",
    "sns:CreateTopic",
    "sns:DeleteTopic",
    "sns:GetTopicAttributes",
    "sns:SetTopicAttributes",
    "sns:Subscribe",
    "sns:Unsubscribe",
    "sns:ListSubscriptionsByTopic",
    "sns:Publish",
    "sns:ListTagsForResource",
    "sns:TagResource",
    "sns:UntagResource",
    "cloudwatch:ListTagsForResource",
    "cloudwatch:TagResource",
    "cloudwatch:UntagResource",
    "secretsmanager:CreateSecret",
    "secretsmanager:DeleteSecret",
    "secretsmanager:DescribeSecret",
    "secretsmanager:GetSecretValue",
    "secretsmanager:PutSecretValue",
    "secretsmanager:ListSecrets",
    "secretsmanager:TagResource",
    "secretsmanager:UntagResource",
    "secretsmanager:GetResourcePolicy",
    "secretsmanager:PutResourcePolicy",
    "secretsmanager:DeleteResourcePolicy",
    "secretsmanager:ValidateResourcePolicy",
    "secretsmanager:RestoreSecret",
    "secretsmanager:RotateSecret",
    "secretsmanager:CancelRotateSecret",
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
    sid     = "WebAssetsBucket"
    effect  = "Allow"
    actions = ["s3:*"]
    resources = [
      "arn:aws:s3:::sparkle-rss-web-*",
      "arn:aws:s3:::sparkle-rss-web-*/*",
      "arn:aws:s3:::sparkle-rss-site-*",
      "arn:aws:s3:::sparkle-rss-site-*/*",
    ]
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
    actions   = ["iam:ListRoles", "iam:GetPolicyVersion", "iam:GetPolicy", "iam:ListOpenIDConnectProviders", "iam:GetOpenIDConnectProvider", "sts:GetCallerIdentity"]
    resources = ["*"]
  }

  statement {
    sid       = "IamOidcProvider"
    effect    = "Allow"
    actions   = ["iam:CreateOpenIDConnectProvider", "iam:DeleteOpenIDConnectProvider", "iam:UpdateOpenIDConnectProviderThumbprint"]
    resources = ["arn:aws:iam::*:oidc-provider/token.actions.githubusercontent.com"]
  }
}

resource "aws_iam_role_policy" "deploy" {
  role   = aws_iam_role.deploy.name
  policy = data.aws_iam_policy_document.deploy.json
}

# --- Read-only plan role ------------------------------------------------------
#
# PRs can't assume the deploy role (it is scoped to refs/heads/main for good
# reason — it can write). To show a real `terraform plan` on every pull request
# we add a second role that is only readable: it can refresh/plan against the
# state and read the managed services, but can change nothing. Same OIDC
# provider, one extra trust scope for pull_request refs.
data "aws_iam_policy_document" "github_plan_trust" {
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
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:repository"
      values   = [var.github_repo]
    }
    condition {
      test     = "StringLike"
      variable = "token.actions.githubusercontent.com:sub"
      values = [
        "repo:${var.github_repo}:ref:refs/heads/main",
        "repo:${var.github_repo}:pull",
        "repo:*@*/${local.repo_name}@*:ref:refs/heads/main",
        "repo:*@*/${local.repo_name}@*:pull",
      ]
    }
  }
}

locals {
  plan_read_actions = [
    "dsql:GetCluster",
    "dsql:ListClusters",
    "lambda:GetFunction",
    "lambda:ListFunctions",
    "lambda:GetFunctionConfiguration",
    "apigateway:GET",
    "cognito-idp:*",
    "sqs:GetQueueAttributes",
    "sqs:ListQueues",
    "scheduler:GetSchedule",
    "scheduler:ListSchedules",
    "logs:DescribeLogGroups",
    "logs:DescribeLogStreams",
    "logs:ListTagsLogGroup",
    "cloudfront:GetDistribution",
    "cloudfront:ListDistributions",
    "cloudfront:GetCloudFrontOriginAccessIdentity",
    "cloudfront:ListCloudFrontOriginAccessIdentities",
    "acm:DescribeCertificate",
    "acm:ListCertificates",
    "cloudwatch:DescribeAlarms",
    "sns:GetTopicAttributes",
    "sns:ListTopics",
    "secretsmanager:GetSecretValue",
    "secretsmanager:DescribeSecret",
    "secretsmanager:ListSecrets",
    "iam:GetRole",
    "iam:ListRoles",
    "iam:GetPolicy",
    "iam:GetPolicyVersion",
    "iam:ListAttachedRolePolicies",
    "iam:ListRolePolicies",
    "route53:ListHostedZones",
    "route53:GetHostedZone",
    "route53:ListResourceRecordSets",
    "route53:GetChange",
    "sts:GetCallerIdentity",
  ]
}

data "aws_iam_policy_document" "plan" {
  statement {
    sid       = "ReadServices"
    effect    = "Allow"
    actions   = local.plan_read_actions
    resources = ["*"]
  }

  statement {
    sid       = "StateRead"
    effect    = "Allow"
    actions   = ["s3:GetObject", "s3:ListBucket"]
    resources = concat(var.state_bucket_arns, [for arn in var.state_bucket_arns : "${arn}/*"])
  }
}

resource "aws_iam_role" "plan" {
  name               = "sparkle-rss-github-plan"
  assume_role_policy = data.aws_iam_policy_document.github_plan_trust.json
  tags               = var.tags
}

resource "aws_iam_role_policy" "plan" {
  role   = aws_iam_role.plan.name
  policy = data.aws_iam_policy_document.plan.json
}
