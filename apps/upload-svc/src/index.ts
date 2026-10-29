import { createApp } from '@viora/service-kit'

const app = createApp('upload-svc')

export default { port: Number(process.env.PORT ?? 13002), fetch: app.fetch }
