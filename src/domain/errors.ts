export type DomainErrorCode =
  | "INVALID_POSITION"
  | "INVALID_NICKNAME"
  | "INVALID_TIER"
  | "INVALID_QUEUE"
  | "INVALID_TIME"
  | "PARTY_FULL"
  | "PARTY_NOT_FOUND"
  | "NOT_OWNER";

/** 도메인 규칙 위반. `code`로 전송 계층이 사용자 메시지를 매핑한다. */
export class DomainError extends Error {
  constructor(
    public readonly code: DomainErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "DomainError";
  }
}
