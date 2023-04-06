import { Job, Queue, QueueScheduler, Worker } from "bullmq";

import { logger } from "@/common/logger";
import { redis } from "@/common/redis";
import { config } from "@/config/index";

import { randomUUID } from "crypto";
import _ from "lodash";
import tracer from "@/common/tracer";
import { AskWebsocketEvent, AskWebsocketEventInfo } from "./events/ask-websocket-event";

const QUEUE_NAME = "ask-websocket-events-trigger-queue";

export const queue = new Queue(QUEUE_NAME, {
  connection: redis.duplicate(),
  defaultJobOptions: {
    attempts: 5,
    removeOnComplete: 1000,
    removeOnFail: 1000,
    timeout: 60000,
  },
});
new QueueScheduler(QUEUE_NAME, { connection: redis.duplicate() });

// BACKGROUND WORKER ONLY
if (config.doBackgroundWork && config.doWebsocketServerWork) {
  const worker = new Worker(
    QUEUE_NAME,
    async (job: Job) => {
      const { kind, data } = job.data as EventInfo;

      switch (kind) {
        case EventKind.AskEvent:
          await tracer.trace(
            "triggerEvent",
            { resource: "AskWebsocketEvent", tags: { event: data } },
            () => AskWebsocketEvent.triggerEvent(data)
          );
          break;
      }
    },
    { connection: redis.duplicate(), concurrency: 20 }
  );
  worker.on("error", (error) => {
    logger.error(QUEUE_NAME, `Worker errored: ${error}`);
  });
}

export enum EventKind {
  NewTopBid = "new-top-bid",
  NewActivity = "new-activity",
  AskEvent = "ask-event",
  BidEvent = "bid-event",
}

export type EventInfo = {
  kind: EventKind.AskEvent;
  data: AskWebsocketEventInfo;
};

export const addToQueue = async (events: EventInfo[]) => {
  if (!config.doWebsocketServerWork) {
    return;
  }

  await queue.addBulk(
    _.map(events, (event) => ({
      name: randomUUID(),
      data: event,
    }))
  );
};
