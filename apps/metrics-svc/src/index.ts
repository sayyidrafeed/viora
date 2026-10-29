import { createApp } from '@viora/service-kit'

const app = createApp('metrics-svc')

export default { port: Number(process.env.PORT ?? 13007), fetch: app.fetch }
