terraform {
  required_version = ">= 1.10"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }
}

data "aws_region" "current" {}
data "aws_iam_policy_document" "lambda_assume" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "api" {
  name               = "sparkle-rss-api"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume.json
  tags               = var.tags
}

resource "aws_iam_role_policy_attachment" "basic_logs" {
  role       = aws_iam_role.api.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

data "aws_iam_policy_document" "dsql_connect" {
  statement {
    effect    = "Allow"
    actions   = ["dsql:DbConnect", "dsql:DbConnectAdmin"]
    resources = [var.dsql_cluster_arn]
  }
}

resource "aws_iam_role_policy" "dsql_connect" {
  role   = aws_iam_role.api.id
  policy = data.aws_iam_policy_document.dsql_connect.json
}

resource "aws_cloudwatch_log_group" "api" {
  name              = "/aws/lambda/sparkle-rss-api"
  retention_in_days = 14
  tags              = var.tags
}

resource "aws_lambda_function" "api" {
  function_name    = "sparkle-rss-api"
  filename         = var.lambda_zip_path
  source_code_hash = filebase64sha256(var.lambda_zip_path)
  handler          = "api.handler"
  runtime          = "nodejs22.x"
  architectures    = ["arm64"]
  memory_size      = 512
  timeout          = 29
  role             = aws_iam_role.api.arn

  environment {
    variables = {
      COGNITO_ISSUER    = var.cognito_issuer
      COGNITO_CLIENT_ID = var.cognito_client_id
      WEB_ORIGINS       = join(",", var.web_origins)
      NODE_ENV          = "production"
      DSQL_ENDPOINT     = var.dsql_endpoint
    }
  }

  logging_config {
    log_format = "JSON"
    log_group  = aws_cloudwatch_log_group.api.name
  }

  tags = var.tags
}

resource "aws_apigatewayv2_api" "this" {
  name          = "sparkle-rss-api"
  protocol_type = "HTTP"
  tags          = var.tags
}

resource "aws_apigatewayv2_authorizer" "cognito" {
  api_id           = aws_apigatewayv2_api.this.id
  authorizer_type  = "JWT"
  identity_sources = ["$request.header.Authorization"]
  name             = "cognito"

  jwt_configuration {
    audience = [var.cognito_client_id]
    issuer   = var.cognito_issuer
  }
}

resource "aws_apigatewayv2_integration" "api" {
  api_id                 = aws_apigatewayv2_api.this.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.api.arn
  payload_format_version = "2.0"
  timeout_milliseconds   = 29000
}

resource "aws_apigatewayv2_stage" "default" {
  api_id      = aws_apigatewayv2_api.this.id
  name        = "$default"
  auto_deploy = true

  dynamic "access_log_settings" {
    for_each = [aws_cloudwatch_log_group.http_api.arn]
    content {
      destination_arn = access_log_settings.value
      format = jsonencode({
        requestId = "$context.requestId"
        ip        = "$context.identity.sourceIp"
        routeKey  = "$context.routeKey"
        status    = "$context.status"
        error     = "$context.error.message"
      })
    }
  }

  default_route_settings {
    throttling_burst_limit = 50
    throttling_rate_limit  = 25
  }

  tags = var.tags
}

resource "aws_cloudwatch_log_group" "http_api" {
  name              = "/aws/http-api/sparkle-rss"
  retention_in_days = 14
  tags              = var.tags
}

locals {
  # greader surface authenticates inside the Lambda (GoogleLogin header);
  # /api/v1 requires a valid Cognito JWT.
  open_routes = [
    "ANY /api/greader.php",
    "ANY /api/greader.php/{proxy+}",
    "ANY /greader.php",
    "ANY /greader.php/{proxy+}",
  ]
  protected_routes = [
    "ANY /api/v1",
    "ANY /api/v1/{proxy+}",
  ]
}

resource "aws_apigatewayv2_route" "open" {
  for_each  = toset(local.open_routes)
  api_id    = aws_apigatewayv2_api.this.id
  route_key = each.value
  target    = "integrations/${aws_apigatewayv2_integration.api.id}"
}

resource "aws_apigatewayv2_route" "protected" {
  for_each           = toset(local.protected_routes)
  api_id             = aws_apigatewayv2_api.this.id
  route_key          = each.value
  target             = "integrations/${aws_apigatewayv2_integration.api.id}"
  authorizer_id      = aws_apigatewayv2_authorizer.cognito.id
  authorization_type = "JWT"
}

resource "aws_lambda_permission" "http_api" {
  statement_id  = "AllowAPIGatewayInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.api.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.this.execution_arn}/*/*"
}
