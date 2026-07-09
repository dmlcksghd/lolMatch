/** 큐(게임 모드). */
export const QUEUES = ["NORMAL", "ARAM", "SOLO", "FLEX", "FLEX5", "OTHER"] as const;

export type Queue = (typeof QUEUES)[number];

export const QUEUE_LABELS: Record<Queue, string> = {
  NORMAL: "일반게임",
  ARAM: "칼바람",
  SOLO: "솔로랭크",
  FLEX: "자유랭크",
  FLEX5: "5인 자유랭",
  OTHER: "기타",
};

export function isQueue(value: unknown): value is Queue {
  return typeof value === "string" && (QUEUES as readonly string[]).includes(value);
}
