import { afterEach, describe, expect, it, vi } from "vitest";
import { processFeed } from "../src/entries/worker-lambda";
import { requestRefresh, requestRefreshSafe } from "../src/refresh";

const mockSend = vi.fn(async () => ({}));

vi.mock("@aws-sdk/client-sqs", () => ({
  SQSClient: vi.fn(() => ({ send: mockSend })),
  SendMessageCommand: vi.fn((input: unknown) => input),
}));

vi.mock("../src/entries/worker-lambda", () => ({
  processFeed: vi.fn(async () => ({ outcome: "ok" })),
}));

const savedEnv = {
  nodeEnv: process.env.NODE_ENV,
  queueUrl: process.env.QUEUE_URL,
};

afterEach(() => {
  if (savedEnv.nodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = savedEnv.nodeEnv;
  if (savedEnv.queueUrl === undefined) delete process.env.QUEUE_URL;
  else process.env.QUEUE_URL = savedEnv.queueUrl;
  vi.clearAllMocks();
});

describe("requestRefresh", () => {
  it("is a no-op under NODE_ENV=test", async () => {
    process.env.NODE_ENV = "test";
    process.env.QUEUE_URL = "https://sqs.example/queue";
    await requestRefresh(42);
    expect(mockSend).not.toHaveBeenCalled();
    expect(processFeed).not.toHaveBeenCalled();
  });

  it("fetches in-process when no queue is configured", async () => {
    process.env.NODE_ENV = "development";
    delete process.env.QUEUE_URL;
    await requestRefresh(7);
    expect(processFeed).toHaveBeenCalledTimes(1);
    expect(processFeed).toHaveBeenCalledWith(7);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("sends the orchestrator-shaped SQS message when QUEUE_URL is set", async () => {
    process.env.NODE_ENV = "production";
    process.env.QUEUE_URL = "https://sqs.example/queue";
    await requestRefresh(9);
    expect(processFeed).not.toHaveBeenCalled();
    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(mockSend).toHaveBeenCalledWith({
      QueueUrl: "https://sqs.example/queue",
      MessageBody: JSON.stringify({ feedId: 9 }),
    });
  });
});

describe("requestRefreshSafe", () => {
  it("swallows enqueue failures instead of throwing", async () => {
    process.env.NODE_ENV = "production";
    process.env.QUEUE_URL = "https://sqs.example/queue";
    mockSend.mockRejectedValueOnce(new Error("boom"));
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(() => requestRefreshSafe(11)).not.toThrow();
      await vi.waitFor(() => expect(errSpy).toHaveBeenCalledTimes(1));
      expect(errSpy.mock.calls[0]?.[0]).toContain("immediate refresh failed");
    } finally {
      errSpy.mockRestore();
    }
  });
});
