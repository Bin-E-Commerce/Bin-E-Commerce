// Metadata kỹ thuật giúp truy vết một nghiệp vụ xuyên qua nhiều service mà không trộn vào dữ liệu domain.
export interface IntegrationEventMetadata {
  correlationId?: string;
  causationId?: string;
  actorUserId?: string;
}

// Envelope chuẩn dùng cho mọi integration event phát qua Kafka.
// Event name và version nằm ngoài data để consumer có thể kiểm tra contract trước khi xử lý payload nghiệp vụ.
export interface IntegrationEventEnvelope<
  TEventName extends string,
  TData,
> {
  eventId: string;
  eventName: TEventName;
  eventVersion: number;
  source: string;
  occurredAt: string;
  aggregateId: string;
  metadata?: IntegrationEventMetadata;
  data: TData;
}
