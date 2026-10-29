import { createApp } from '@viora/service-kit'

const app = createApp('live-svc')

export default { port: Number(process.env.PORT ?? 13011), fetch: app.fetch }
