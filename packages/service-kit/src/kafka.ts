import {
  compatibilityPartitioner,
  Consumer,
  ProduceAcks,
  Producer,
  stringDeserializers,
  stringSerializers,
  type Message,
} from '@platformatic/kafka'

export type KafkaMessage = Message<string, string, string, string>
export type KafkaProducer = Producer<string, string, string, string>

// compatibilityPartitioner: partisi sama dengan klien Java (Flink, rpk), jadi urutan per key konsisten lintas producer.
export function createProducer(clientId: string, brokers: string[]): KafkaProducer {
  return new Producer({
    clientId,
    bootstrapBrokers: brokers,
    serializers: stringSerializers,
    idempotent: true,
    acks: ProduceAcks.ALL,
    partitioner: compatibilityPartitioner,
  })
}

export function createConsumer(groupId: string, clientId: string, brokers: string[]) {
  return new Consumer({
    groupId,
    clientId,
    bootstrapBrokers: brokers,
    deserializers: stringDeserializers,
    autocommit: false,
    sessionTimeout: 10_000,
    heartbeatInterval: 1_000,
    maxWaitTime: 200,
  })
}
