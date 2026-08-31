terraform {
  required_version = ">= 1.10"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }
}

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

resource "aws_iam_role" "orchestrator" {
  name               = "sparkle-rss-ingest-orchestrator"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume.json
  tags               = var.tags
}

resource "aws_iam_role_policy_attachment" "orchestrator_logs" {
  role       = aws_iam_role.orchestrator.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_cloudwatch_log_group" "orchestrator" {
  name              = "/aws/lambda/sparkle-rss-ingest-orchestrator"
  retention_in_days = 14
}

data "aws_iam_policy_document" "orchestrator_runtime" {
  statement {
    effect    = "Allow"
    actions   = ["sqs:SendMessage"]
    resources = [aws_sqs_queue.refresh.arn]
  }
}

resource "aws_iam_role_policy" "orchestrator_runtime" {
  role   = aws_iam_role.orchestrator.id
  policy = data.aws_iam_policy_document.orchestrator_runtime.json
}

data "aws_iam_policy_document" "dsql_connect" {
  statement {
    effect    = "Allow"
    actions   = ["dsql:DbConnect", "dsql:DbConnectAdmin"]
    resources = [var.dsql_cluster_arn]
  }
}

resource "aws_s3_bucket" "media" {
  bucket_prefix = "sparkle-rss-media-"
  tags          = var.tags
}

resource "aws_s3_bucket_public_access_block" "media" {
  bucket                  = aws_s3_bucket.media.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

data "aws_iam_policy_document" "worker_media" {
  statement {
    effect    = "Allow"
    actions   = ["s3:PutObject"]
    resources = ["${aws_s3_bucket.media.arn}/*"]
  }
}

resource "aws_iam_role_policy" "worker_media" {
  role   = aws_iam_role.worker.id
  policy = data.aws_iam_policy_document.worker_media.json
}

resource "aws_iam_role_policy" "orchestrator_dsql" {
  role   = aws_iam_role.orchestrator.id
  policy = data.aws_iam_policy_document.dsql_connect.json
}

resource "aws_iam_role_policy" "worker_dsql" {
  role   = aws_iam_role.worker.id
  policy = data.aws_iam_policy_document.dsql_connect.json
}

resource "aws_lambda_function" "orchestrator" {
  function_name    = "sparkle-rss-ingest-orchestrator"
  filename         = "${var.lambda_zip_dir}/ingest-orchestrator.zip"
  source_code_hash = filebase64sha256("${var.lambda_zip_dir}/ingest-orchestrator.zip")
  handler          = "ingest-orchestrator.handler"
  runtime          = "nodejs22.x"
  architectures    = ["arm64"]
  memory_size      = 256
  timeout          = 60
  role             = aws_iam_role.orchestrator.arn

  environment {
    variables = {
      QUEUE_URL         = aws_sqs_queue.refresh.url
      DSQL_ENDPOINT     = var.dsql_endpoint
      MEDIA_BUCKET      = aws_s3_bucket.media.bucket
      MAX_FEEDS_PER_RUN = "100"
      NODE_ENV          = "production"
    }
  }

  logging_config {
    log_format = "JSON"
    log_group  = aws_cloudwatch_log_group.orchestrator.name
  }

  tags = var.tags
}

resource "aws_iam_role" "worker" {
  name               = "sparkle-rss-ingest-worker"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume.json
  tags               = var.tags
}

resource "aws_iam_role_policy_attachment" "worker_logs" {
  role       = aws_iam_role.worker.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_cloudwatch_log_group" "worker" {
  name              = "/aws/lambda/sparkle-rss-ingest-worker"
  retention_in_days = 14
}

resource "aws_lambda_function" "worker" {
  function_name                  = "sparkle-rss-ingest-worker"
  filename                       = "${var.lambda_zip_dir}/ingest-worker.zip"
  source_code_hash               = filebase64sha256("${var.lambda_zip_dir}/ingest-worker.zip")
  handler                        = "ingest-worker.handler"
  runtime                        = "nodejs22.x"
  architectures                  = ["arm64"]
  memory_size                    = 512
  timeout                        = 180
  reserved_concurrent_executions = 10
  role                           = aws_iam_role.worker.arn

  environment {
    variables = {
      DSQL_ENDPOINT = var.dsql_endpoint
      MEDIA_BUCKET  = aws_s3_bucket.media.bucket
      NODE_ENV      = "production"
    }
  }

  logging_config {
    log_format = "JSON"
    log_group  = aws_cloudwatch_log_group.worker.name
  }

  tags = var.tags
}

# Queue plumbing (workers start consuming in Phase 3; harmless to wire now).

resource "aws_sqs_queue" "refresh_dlq" {
  name                      = "sparkle-rss-feed-refresh-dlq"
  message_retention_seconds = 1209600
  tags                      = var.tags
}

resource "aws_sqs_queue" "refresh" {
  name                       = "sparkle-rss-feed-refresh"
  visibility_timeout_seconds = 200
  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.refresh_dlq.arn
    maxReceiveCount     = 5
  })
  tags = var.tags
}

data "aws_iam_policy_document" "worker_sqs" {
  statement {
    effect    = "Allow"
    actions   = ["sqs:ReceiveMessage", "sqs:DeleteMessage", "sqs:GetQueueAttributes"]
    resources = [aws_sqs_queue.refresh.arn]
  }
}

resource "aws_iam_role_policy" "worker_sqs" {
  role   = aws_iam_role.worker.name
  policy = data.aws_iam_policy_document.worker_sqs.json
}

resource "aws_lambda_event_source_mapping" "refresh" {
  event_source_arn                   = aws_sqs_queue.refresh.arn
  function_name                      = aws_lambda_function.worker.arn
  batch_size                         = 5
  maximum_batching_window_in_seconds = 10
}

resource "aws_iam_role" "scheduler_invoke" {
  name = "sparkle-rss-scheduler-invoke"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Action    = "sts:AssumeRole"
      Principal = { Service = "scheduler.amazonaws.com" }
    }]
  })
  tags = var.tags
}

resource "aws_iam_role_policy" "scheduler_invoke" {
  role = aws_iam_role.scheduler_invoke.name
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = "lambda:InvokeFunction"
      Resource = aws_lambda_function.orchestrator.arn
    }]
  })
}

resource "aws_scheduler_schedule" "feed_refresh" {
  name = "sparkle-rss-feed-refresh"
  flexible_time_window {
    mode = "OFF"
  }
  schedule_expression = "rate(5 minutes)"
  target {
    arn      = aws_lambda_function.orchestrator.arn
    role_arn = aws_iam_role.scheduler_invoke.arn
  }
}


# --- alerts -----------------------------------------------------------------

resource "aws_sns_topic" "alerts" {
  name = "sparkle-rss-alerts"
  tags = var.tags
}

resource "aws_sns_topic_subscription" "email" {
  count     = var.alarm_email == null ? 0 : 1
  topic_arn = aws_sns_topic.alerts.arn
  protocol  = "email"
  endpoint  = var.alarm_email
}

resource "aws_cloudwatch_metric_alarm" "dlq_not_empty" {
  alarm_name          = "sparkle-rss-refresh-dlq-not-empty"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "ApproximateNumberOfMessagesVisible"
  namespace           = "AWS/SQS"
  period              = 300
  statistic           = "Maximum"
  dimensions = {
    QueueName = aws_sqs_queue.refresh_dlq.name
  }
  alarm_actions      = [aws_sns_topic.alerts.arn]
  treat_missing_data = "notBreaching"
  tags               = var.tags
}

resource "aws_cloudwatch_metric_alarm" "worker_errors" {
  alarm_name          = "sparkle-rss-worker-errors"
  comparison_operator = "GreaterThanOrEqualToThreshold"
  evaluation_periods  = 2
  metric_name         = "Errors"
  namespace           = "AWS/Lambda"
  period              = 300
  statistic           = "Sum"
  dimensions = {
    FunctionName = aws_lambda_function.worker.function_name
  }
  alarm_actions      = [aws_sns_topic.alerts.arn]
  treat_missing_data = "notBreaching"
  tags               = var.tags
}

resource "aws_cloudwatch_metric_alarm" "orchestrator_errors" {
  alarm_name          = "sparkle-rss-orchestrator-errors"
  comparison_operator = "GreaterThanOrEqualToThreshold"
  evaluation_periods  = 1
  metric_name         = "Errors"
  namespace           = "AWS/Lambda"
  period              = 300
  statistic           = "Sum"
  dimensions = {
    FunctionName = aws_lambda_function.orchestrator.function_name
  }
  alarm_actions      = [aws_sns_topic.alerts.arn]
  treat_missing_data = "notBreaching"
  tags               = var.tags
}

output "alerts_topic_arn" {
  value = aws_sns_topic.alerts.arn
}

output "refresh_queue_url" {
  value = aws_sqs_queue.refresh.url
}

output "refresh_queue_arn" {
  value = aws_sqs_queue.refresh.arn
}
