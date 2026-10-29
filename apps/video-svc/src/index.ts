import { createApp } from '@viora/service-kit'

const app = createApp('video-svc')

export default { port: Number(process.env.PORT ?? 13004), fetch: app.fetch }
