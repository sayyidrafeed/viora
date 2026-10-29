import { createApp } from '@viora/service-kit'

const app = createApp('feed-svc')

export default { port: Number(process.env.PORT ?? 13006), fetch: app.fetch }
