import { createApp } from '@viora/service-kit'

const app = createApp('social-svc')

export default { port: Number(process.env.PORT ?? 13005), fetch: app.fetch }
