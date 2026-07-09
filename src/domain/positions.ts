/**
 * 롤 5개 포지션 정의. 도메인 전역에서 이 상수를 단일 출처로 사용한다.
 */
export const POSITIONS = ["TOP", "JGL", "MID", "ADC", "SUP"] as const;

export type Position = (typeof POSITIONS)[number];

export interface PositionLabel {
  ko: string;
  en: string;
}

export const POSITION_LABELS: Record<Position, PositionLabel> = {
  TOP: { ko: "탑", en: "TOP" },
  JGL: { ko: "정글", en: "JUNGLE" },
  MID: { ko: "미드", en: "MID" },
  ADC: { ko: "원딜", en: "BOT" },
  SUP: { ko: "서폿", en: "SUPPORT" },
};

export function isPosition(value: unknown): value is Position {
  return typeof value === "string" && (POSITIONS as readonly string[]).includes(value);
}
