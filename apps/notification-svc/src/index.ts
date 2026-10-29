import { createApp } from '@viora/service-kit'

const app = createApp('notification-svc')

export default { port: Number(process.env.PORT ?? 13010), fetch: app.fetch }
